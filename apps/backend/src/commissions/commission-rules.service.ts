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
import {
  normalizeEffectiveFrom,
  normalizeEffectiveTo,
  toDhakaDateString,
  validityWindowsOverlap,
} from './commission-dates';

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
 * Three rules govern everything here:
 *
 *   1. `purpose` must be a real, commissionable order status. Not free text —
 *      an admin cannot invent a status, and cannot pay for one that is not a
 *      meaningful operational action.
 *
 *   2. An employee holds at most ONE active rule per purpose. A second active
 *      rule for the same employee + action is rejected by the database
 *      (partial unique index `CommissionRuleV2_no_overlapping_active_idx`) and
 *      pre-empted here with a message that names the conflict. Stacking is
 *      deliberately not implicit: changing the rate is done by editing the
 *      amount on the live rule, which leaves already-credited earnings untouched
 *      because the ledger snapshots every calculation input.
 *
 *   3. Validity windows are Dhaka calendar days, inclusive at both ends. A rule
 *      with no end date keeps applying until it is explicitly ended; a rule
 *      with no start date has always applied. See ./commission-dates.
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

    // Compare the NORMALISED bounds: a start of 2026-11-01 and an end of
    // 2026-11-01 are the same Dhaka day, so the rule is valid (one day long).
    const fromDate = normalizeEffectiveFrom(dto.effectiveFrom ?? null);
    const toDate = normalizeEffectiveTo(dto.effectiveTo ?? null);
    if (fromDate && toDate && toDate < fromDate) {
      throw new BadRequestException('End date cannot be before the start date');
    }

    await this.assertNoOverlap(
      dto.employeeId,
      dto.purpose,
      undefined,
      fromDate,
      toDate,
      dto.isActive !== false,
    );
  }

  /**
   * Reject an active rule that overlaps an existing active rule for the same
   * employee + purpose.
   *
   * The database enforces the same invariant via the partial unique index
   * `CommissionRuleV2_no_overlapping_active_idx` on (employeeId, purpose,
   * isActive) WHERE isActive = true — that is what makes "one active rule per
   * employee per action" a guarantee rather than a convention. This check runs
   * first only so the admin gets a message naming the clash instead of a bare
   * constraint violation.
   *
   * Both bounds are inclusive and a null bound is unbounded, so a rule with no
   * dates intersects every active rule for its employee + purpose.
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

    const fromDate = from ? normalizeEffectiveFrom(from) : null;
    const toDate = to ? normalizeEffectiveTo(to) : null;

    const existing = await this.prisma.commissionRuleV2.findMany({
      where: {
        employeeId,
        purpose,
        isActive: true,
        ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}),
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });

    const clash = existing.find((e) =>
      validityWindowsOverlap(
        { effectiveFrom: fromDate, effectiveTo: toDate },
        { effectiveFrom: e.effectiveFrom, effectiveTo: e.effectiveTo },
      ),
    );

    if (clash) {
      throw new ConflictException(
        'This employee already has an active commission rule for that action. Edit or deactivate the existing rule instead of adding a second one.',
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
      effectiveFrom: normalizeEffectiveFrom(dto.effectiveFrom ?? null),
      effectiveTo: normalizeEffectiveTo(dto.effectiveTo ?? null),
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
      data.effectiveFrom = normalizeEffectiveFrom(dto.effectiveFrom);
    }
    if (dto.effectiveTo !== undefined) {
      data.effectiveTo = normalizeEffectiveTo(dto.effectiveTo);
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return data;
  }

  /**
   * End a rule today, in the business timezone.
   *
   * This is deliberately NOT the same as deactivating:
   *
   *   - "End now" closes the validity window, so the rule stops applying after
   *     today while remaining fully visible and auditable, with its complete
   *     configuration intact. The record is the history of what was agreed.
   *   - "Deactivate" removes it from future qualification but leaves the window
   *     open, so re-activating restores exactly the previous behaviour.
   *
   * The end date is set to the END of the current Dhaka day, so the rule still
   * pays for every qualifying order that happens today — the operator asked to
   * end it now, not to retroactively cancel today's work.
   *
   * Already-credited earnings are untouched: the ledger snapshots the
   * calculation inputs, so no historical amount can move.
   */
  async endNow(id: string) {
    const rule = await this.prisma.commissionRuleV2.findUnique({
      where: { id },
      select: { id: true, effectiveTo: true, effectiveFrom: true },
    });
    if (!rule) throw new NotFoundException('Commission rule not found');

    // Idempotent: re-ending an already-ended rule is a no-op, not an error, and
    // must never shorten a window the operator set deliberately in the future.
    if (rule.effectiveTo !== null) return this.decorate(id);

    const today = toDhakaDateString(new Date());
    await this.prisma.commissionRuleV2.update({
      where: { id },
      data: { effectiveTo: normalizeEffectiveTo(today) },
    });
    return this.decorate(id);
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
      // Emitted as the Dhaka calendar day the operator configured, not as a raw
      // ISO timestamp. Without this every consumer would have to re-derive the
      // timezone, and slicing the UTC form would display the previous day.
      effectiveFrom: toDhakaDateString(rule.effectiveFrom),
      effectiveTo: toDhakaDateString(rule.effectiveTo),
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