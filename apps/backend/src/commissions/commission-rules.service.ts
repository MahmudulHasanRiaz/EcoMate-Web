import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMMISSIONABLE_PURPOSES,
  describeRule,
  type ThresholdPeriod,
  type ValueBasis,
} from './commission-math';

const VALID_PERIODS: ThresholdPeriod[] = ['daily', 'weekly', 'monthly', 'yearly'];
const VALID_BASES: ValueBasis[] = ['order_total', 'subtotal'];

export interface RuleInput {
  employeeId: string;
  name?: string | null;
  purpose: string;
  amountType: 'fixed' | 'percent';
  amount: number;
  valueBasis?: string;
  minOrderAmount?: number | null;
  capPerOrder?: number | null;
  minimumCount?: number | null;
  thresholdPeriod?: string | null;
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
  isActive?: boolean;
  createdById?: string | null;
}

/**
 * CRUD for Commission Engine v2 rules.
 *
 * Two rules govern everything here:
 *
 *   1. `purpose` must be a real, commissionable order status. Not free text —
 *      an admin cannot invent a status, and cannot pay for one that is not a
 *      meaningful operational action.
 *
 *   2. Two active rules for the same employee and purpose may not overlap in
 *      time. Stacking is not implicit; if a business genuinely wants two rules
 *      on one purpose they must be given disjoint validity windows, which is a
 *      deliberate and reviewable choice rather than an accident of ordering.
 */
@Injectable()
export class CommissionRulesService {
  private readonly logger = new Logger(CommissionRulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Statuses an admin may build a rule against, read from OrderStatus. */
  async listCommissionablePurposes() {
    const statuses = await this.prisma.orderStatus.findMany({
      where: { name: { in: [...COMMISSIONABLE_PURPOSES] } },
      select: { id: true, name: true, color: true },
      orderBy: { sortOrder: 'asc' },
    });
    return statuses;
  }

  async create(dto: RuleInput) {
    await this.validate(dto);

    try {
      const rule = await this.prisma.commissionRuleV2.create({
        data: this.toCreateData(dto),
      });
      return this.decorate(rule.id);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'An active rule for this employee and action already exists. Deactivate it or give the new rule a different validity window.',
        );
      }
      throw err;
    }
  }

  async list(filter: { employeeId?: string; isActive?: boolean } = {}) {
    const where: Prisma.CommissionRuleV2WhereInput = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.isActive !== undefined) where.isActive = filter.isActive;

    const rules = await this.prisma.commissionRuleV2.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            department: { select: { name: true } },
            betterAuthUser: { select: { name: true, image: true } },
          },
        },
      },
      orderBy: [{ employeeId: 'asc' }, { purpose: 'asc' }, { createdAt: 'asc' }],
    });

    return rules.map((r) => this.toResponse(r, r.employee));
  }

  async get(id: string) {
    const rule = await this.prisma.commissionRuleV2.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            betterAuthUser: { select: { name: true, image: true } },
          },
        },
      },
    });
    if (!rule) throw new NotFoundException('Commission rule not found');
    return this.toResponse(rule, rule.employee);
  }

  async update(id: string, dto: Partial<RuleInput>) {
    const existing = await this.prisma.commissionRuleV2.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Commission rule not found');

    // Validate the merged shape so a partial update cannot produce an invalid
    // rule (e.g. clearing amount while leaving a threshold).
    const merged: RuleInput = {
      employeeId: dto.employeeId ?? existing.employeeId,
      purpose: dto.purpose ?? existing.purpose,
      amountType: (dto.amountType ?? existing.amountType) as 'fixed' | 'percent',
      amount: dto.amount ?? Number(existing.amount),
      valueBasis: dto.valueBasis ?? existing.valueBasis,
      minOrderAmount:
        dto.minOrderAmount !== undefined
          ? dto.minOrderAmount
          : existing.minOrderAmount !== null
            ? Number(existing.minOrderAmount)
            : null,
      capPerOrder:
        dto.capPerOrder !== undefined
          ? dto.capPerOrder
          : existing.capPerOrder !== null
            ? Number(existing.capPerOrder)
            : null,
      minimumCount: dto.minimumCount !== undefined ? dto.minimumCount : existing.minimumCount,
      thresholdPeriod:
        dto.thresholdPeriod !== undefined ? dto.thresholdPeriod : existing.thresholdPeriod,
      effectiveFrom:
        dto.effectiveFrom !== undefined ? dto.effectiveFrom : existing.effectiveFrom,
      effectiveTo: dto.effectiveTo !== undefined ? dto.effectiveTo : existing.effectiveTo,
    };
    await this.validate(merged);

    try {
      await this.prisma.commissionRuleV2.update({
        where: { id },
        data: this.toUpdateData(dto),
      });
      return this.decorate(id);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'Another active rule for this employee and action already covers part of that period.',
        );
      }
      throw err;
    }
  }

  /**
   * Deactivate a rule.
   *
   * Deactivation never deletes. Historical ledger rows reference the rule and
   * carry their own snapshot of the calculation, so past earnings are
   * unaffected and the rule remains auditable.
   */
  async setActive(id: string, isActive: boolean) {
    const rule = await this.prisma.commissionRuleV2.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Commission rule not found');

    if (!isActive) {
      await this.prisma.commissionRuleV2.update({ where: { id }, data: { isActive: false } });
      return this.decorate(id);
    }

    // Re-activating must still respect the no-overlap invariant.
    await this.assertNoOverlap(rule.employeeId, rule.purpose, id, rule.effectiveFrom, rule.effectiveTo);
    await this.prisma.commissionRuleV2.update({ where: { id }, data: { isActive: true } });
    return this.decorate(id);
  }

  /** Preview the human-readable effect of a rule without saving it. */
  async preview(dto: RuleInput) {
    await this.validate(dto);
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { betterAuthUser: { select: { name: true } } },
    });

    return {
      summary: describeRule({
        employeeName: employee?.betterAuthUser?.name ?? null,
        purpose: dto.purpose,
        amountType: dto.amountType,
        amount: dto.amount,
        minimumCount: dto.minimumCount ?? null,
        thresholdPeriod: dto.thresholdPeriod ?? null,
        minOrderAmount: dto.minOrderAmount ?? null,
        capPerOrder: dto.capPerOrder ?? null,
      }),
    };
  }

  private async validate(dto: RuleInput) {
    if (!dto.employeeId) throw new BadRequestException('Employee is required');

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    // Purpose must be a real, commissionable status — never free text.
    if (!COMMISSIONABLE_PURPOSES.includes(dto.purpose as never)) {
      throw new BadRequestException(
        `Commission action must be one of: ${COMMISSIONABLE_PURPOSES.join(', ')}`,
      );
    }
    const status = await this.prisma.orderStatus.findFirst({
      where: { name: dto.purpose },
      select: { id: true },
    });
    if (!status) {
      throw new BadRequestException(
        `'${dto.purpose}' is not an order status in this installation.`,
      );
    }

    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('Commission amount must be greater than zero');
    }
    if (dto.amountType === 'percent' && dto.amount > 100) {
      throw new BadRequestException('Percentage cannot exceed 100');
    }

    const basis = dto.valueBasis ?? 'order_total';
    if (!VALID_BASES.includes(basis as ValueBasis)) {
      throw new BadRequestException(`Value basis must be one of: ${VALID_BASES.join(', ')}`);
    }

    // Threshold is a unit: a count needs a period, and a period needs a count.
    const min = dto.minimumCount ?? null;
    const period = dto.thresholdPeriod ?? null;
    if (min !== null && period === null) {
      throw new BadRequestException('A minimum count requires a period');
    }
    if (min === null && period !== null) {
      throw new BadRequestException('A period requires a minimum count');
    }
    if (min !== null && (!Number.isInteger(min) || min <= 0)) {
      throw new BadRequestException('Minimum count must be a positive whole number');
    }
    if (period !== null && !VALID_PERIODS.includes(period as ThresholdPeriod)) {
      throw new BadRequestException(`Period must be one of: ${VALID_PERIODS.join(', ')}`);
    }

    for (const [label, value] of [
      ['Minimum order amount', dto.minOrderAmount],
      ['Cap per order', dto.capPerOrder],
    ] as const) {
      if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new BadRequestException(`${label} cannot be negative`);
      }
    }

    if (dto.effectiveFrom && dto.effectiveTo) {
      if (new Date(dto.effectiveTo) < new Date(dto.effectiveFrom)) {
        throw new BadRequestException('End date cannot be before the start date');
      }
    }

    await this.assertNoOverlap(
      dto.employeeId,
      dto.purpose,
      undefined,
      dto.effectiveFrom ?? null,
      dto.effectiveTo ?? null,
      dto.isActive !== false,
    );
  }

  /**
   * Reject an active rule that overlaps an existing active rule for the same
   * employee + purpose. Two rules with no date bounds always overlap.
   */
  private async assertNoOverlap(
    employeeId: string,
    purpose: string,
    excludeRuleId: string | undefined,
    from: Date | string | null,
    to: Date | string | null,
    isActive = true,
  ) {
    if (!isActive) return;

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    const existing = await this.prisma.commissionRuleV2.findMany({
      where: {
        employeeId,
        purpose,
        isActive: true,
        ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}),
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });

    const clashes = existing.filter((e) => {
      // Standard half-open interval overlap: [aFrom, aTo] ∩ [bFrom, bTo).
      // A null bound means unbounded on that side.
      const aFrom = e.effectiveFrom;
      const aTo = e.effectiveTo;
      const startsBeforeOtherEnds = aTo === null || (toDate !== null && aTo >= toDate);
      const endsAfterOtherStarts = aFrom === null || (fromDate !== null && aFrom <= fromDate);
      return startsBeforeOtherEnds && endsAfterOtherStarts;
    });

    if (clashes.length > 0) {
      throw new ConflictException(
        'Another active rule already covers this action for this employee during the selected period.',
      );
    }
  }

  private toCreateData(dto: RuleInput): Prisma.CommissionRuleV2CreateInput {
    return {
      employee: { connect: { id: dto.employeeId } },
      name: dto.name ?? null,
      purpose: dto.purpose,
      amountType: dto.amountType,
      amount: new Prisma.Decimal(dto.amount),
      valueBasis: dto.valueBasis ?? 'order_total',
      minOrderAmount:
        dto.minOrderAmount !== null && dto.minOrderAmount !== undefined
          ? new Prisma.Decimal(dto.minOrderAmount)
          : null,
      capPerOrder:
        dto.capPerOrder !== null && dto.capPerOrder !== undefined
          ? new Prisma.Decimal(dto.capPerOrder)
          : null,
      minimumCount: dto.minimumCount ?? null,
      thresholdPeriod: dto.thresholdPeriod ?? null,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      isActive: dto.isActive !== false,
    };
  }

  private toUpdateData(dto: Partial<RuleInput>): Prisma.CommissionRuleV2UpdateInput {
    const data: Prisma.CommissionRuleV2UpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.purpose !== undefined) data.purpose = dto.purpose;
    if (dto.amountType !== undefined) data.amountType = dto.amountType;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.valueBasis !== undefined) data.valueBasis = dto.valueBasis;
    if (dto.minOrderAmount !== undefined) {
      data.minOrderAmount =
        dto.minOrderAmount === null ? null : new Prisma.Decimal(dto.minOrderAmount);
    }
    if (dto.capPerOrder !== undefined) {
      data.capPerOrder = dto.capPerOrder === null ? null : new Prisma.Decimal(dto.capPerOrder);
    }
    if (dto.minimumCount !== undefined) data.minimumCount = dto.minimumCount;
    if (dto.thresholdPeriod !== undefined) data.thresholdPeriod = dto.thresholdPeriod;
    if (dto.effectiveFrom !== undefined) {
      data.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    }
    if (dto.effectiveTo !== undefined) {
      data.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return data;
  }

  /** Load a rule with its employee for display. */
  private async decorate(id: string) {
    return this.get(id);
  }

  private toResponse(
    rule: {
      id: string;
      employeeId: string;
      name: string | null;
      purpose: string;
      amountType: 'fixed' | 'percent';
      amount: Prisma.Decimal;
      valueBasis: string;
      minOrderAmount: Prisma.Decimal | null;
      capPerOrder: Prisma.Decimal | null;
      minimumCount: number | null;
      thresholdPeriod: string | null;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
      isActive: boolean;
      createdAt: Date;
    },
    employee?: {
      id: string;
      employeeId: string;
      department?: { name: string } | null;
      betterAuthUser?: { name: string; image: string | null } | null;
    } | null,
  ) {
    const response = {
      id: rule.id,
      employeeId: rule.employeeId,
      employeeName: employee?.betterAuthUser?.name ?? null,
      employeeCode: employee?.employeeId ?? null,
      department: employee?.department?.name ?? null,
      avatar: employee?.betterAuthUser?.image ?? null,
      name: rule.name,
      purpose: rule.purpose,
      amountType: rule.amountType,
      amount: Number(rule.amount),
      valueBasis: rule.valueBasis,
      minOrderAmount: rule.minOrderAmount !== null ? Number(rule.minOrderAmount) : null,
      capPerOrder: rule.capPerOrder !== null ? Number(rule.capPerOrder) : null,
      minimumCount: rule.minimumCount,
      thresholdPeriod: rule.thresholdPeriod,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      isActive: rule.isActive,
      createdAt: rule.createdAt,
      summary: describeRule({
        employeeName: employee?.betterAuthUser?.name ?? null,
        purpose: rule.purpose,
        amountType: rule.amountType,
        amount: rule.amount,
        minimumCount: rule.minimumCount,
        thresholdPeriod: rule.thresholdPeriod,
        minOrderAmount: rule.minOrderAmount,
        capPerOrder: rule.capPerOrder,
      }),
    };
    return response;
  }
}