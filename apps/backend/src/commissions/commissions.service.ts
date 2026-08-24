import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommissionAmountType, LedgerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { UpdateCommissionRuleDto } from './dto/update-commission-rule.dto';
import { ReverseEarningDto } from './dto/reverse-earning.dto';

@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);
  private confirmedStatusIdCache: string | null | undefined;

  constructor(private prisma: PrismaService) {}

  // Resolve the default 'Confirmed' OrderStatus id at runtime. The Commission
  // model has no statusKey field, so match by name (case-insensitive) per the
  // plan. Cached across the service lifetime (status table is static).
  private async resolveConfirmedStatusId(): Promise<string | null> {
    if (this.confirmedStatusIdCache !== undefined)
      return this.confirmedStatusIdCache;
    const status = await this.prisma.orderStatus.findFirst({
      where: { name: { equals: 'Confirmed', mode: 'insensitive' } },
    });
    this.confirmedStatusIdCache = status?.id ?? null;
    return this.confirmedStatusIdCache;
  }

  async createRule(dto: CreateCommissionRuleDto, actorId?: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (dto.triggerStatusId) {
      const st = await this.prisma.orderStatus.findUnique({
        where: { id: dto.triggerStatusId },
      });
      if (!st) throw new NotFoundException('Trigger status not found');
    }
    return this.prisma.commissionRule.create({
      data: {
        employeeId: dto.employeeId,
        triggerStatusId: dto.triggerStatusId ?? null,
        amountType: dto.amountType,
        amount: dto.amount,
        valueBasis: dto.valueBasis ?? 'order_total',
        minOrderAmount: dto.minOrderAmount ?? null,
        capPerOrder: dto.capPerOrder ?? null,
        isActive: dto.isActive ?? true,
        createdById: actorId ?? null,
      },
    });
  }

  async updateRule(id: string, dto: UpdateCommissionRuleDto) {
    const existing = await this.prisma.commissionRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Commission rule not found');
    if (dto.triggerStatusId) {
      const st = await this.prisma.orderStatus.findUnique({
        where: { id: dto.triggerStatusId },
      });
      if (!st) throw new NotFoundException('Trigger status not found');
    }
    if (dto.employeeId) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: dto.employeeId },
      });
      if (!emp) throw new NotFoundException('Employee not found');
    }
    return this.prisma.commissionRule.update({
      where: { id },
      data: {
        ...(dto.employeeId !== undefined ? { employeeId: dto.employeeId } : {}),
        ...(dto.triggerStatusId !== undefined
          ? { triggerStatusId: dto.triggerStatusId }
          : {}),
        ...(dto.amountType !== undefined ? { amountType: dto.amountType } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.valueBasis !== undefined ? { valueBasis: dto.valueBasis } : {}),
        ...(dto.minOrderAmount !== undefined
          ? { minOrderAmount: dto.minOrderAmount }
          : {}),
        ...(dto.capPerOrder !== undefined
          ? { capPerOrder: dto.capPerOrder }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async setActive(id: string, isActive: boolean) {
    const existing = await this.prisma.commissionRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Commission rule not found');
    return this.prisma.commissionRule.update({
      where: { id },
      data: { isActive },
    });
  }

  async deleteRule(id: string) {
    const existing = await this.prisma.commissionRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Commission rule not found');
    await this.prisma.commissionRule.delete({ where: { id } });
    return { success: true, id };
  }

  async listRules(filter: { employeeId?: string; isActive?: boolean } = {}) {
    const where: Prisma.CommissionRuleWhereInput = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.isActive !== undefined) where.isActive = filter.isActive;
    return this.prisma.commissionRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { id: true, employeeId: true } },
        triggerStatus: true,
      },
    });
  }

  async listEarnings(
    filter: {
      employeeId?: string;
      reversed?: string;
      inPayroll?: string;
    } = {},
    page = 1,
    perPage = 20,
  ) {
    page = Math.max(1, page);
    perPage = Math.max(1, Math.min(100, perPage));
    const where: Prisma.CommissionEarningWhereInput = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.inPayroll === 'true') where.payslipId = { not: null };
    if (filter.inPayroll === 'false') where.payslipId = null;
    if (filter.reversed === 'true') where.reversals = { some: {} };
    if (filter.reversed === 'false') where.reversals = { none: {} };
    const [data, total, totals, reversalTotals] = await Promise.all([
      this.prisma.commissionEarning.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, employeeId: true } },
          rule: true,
          order: { select: { id: true, displayId: true, total: true } },
          reversals: {
            select: {
              id: true,
              amount: true,
              reason: true,
              reversedAt: true,
              reversedById: true,
            },
          },
        },
      }),
      this.prisma.commissionEarning.count({ where }),
      this.prisma.commissionEarning.aggregate({
        where,
        _sum: { amount: true },
      }),
      this.prisma.commissionReversal.aggregate({
        where: { commissionEarning: where },
        _sum: { amount: true },
      }),
    ]);
    const totalCommission = Math.round(Number(totals._sum.amount ?? 0) * 100) / 100;
    const totalReversed = Math.round(Number(reversalTotals._sum.amount ?? 0) * 100) / 100;
    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        totals: {
          totalCommission,
          totalReversed,
          netPayable: Math.round((totalCommission - totalReversed) * 100) / 100,
        },
      },
    };
  }

  // Decision #1 (§D1): the original earning is immutable — a reversal is ALWAYS
  // recorded as a CommissionReversal row (it reduces future payable; if the
  // earning is inside an approved payslip the payslip snapshot is untouched).
  // Idempotent per (earningId, orderId) — re-calling with the same order context
  // returns the existing reversal instead of duplicating; a manual reversal
  // (orderId null) with a prior manual reversal is a friendly 409.
  async reverseEarning(
    earningId: string,
    dto: ReverseEarningDto,
    actorId?: string,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('reason is required');
    }
    const earning = await this.prisma.commissionEarning.findUnique({
      where: { id: earningId },
    });
    if (!earning) throw new NotFoundException('Commission earning not found');

    if (earning.status === LedgerStatus.draft) {
      throw new BadRequestException(
        'Draft earnings cannot be reversed — approve the earning first',
      );
    }

    if (dto.orderId) {
      const existing = await this.prisma.commissionReversal.findFirst({
        where: { commissionEarningId: earningId, orderId: dto.orderId },
      });
      if (existing) return existing;
    } else {
      const existing = await this.prisma.commissionReversal.findFirst({
        where: { commissionEarningId: earningId, orderId: null },
      });
      if (existing) {
        throw new ConflictException('This commission is already reversed');
      }
    }

    const earningAmount = new Prisma.Decimal(earning.amount);
    let amount: Prisma.Decimal;
    if (dto.refundedAmount != null) {
      const refund = new Prisma.Decimal(dto.refundedAmount);
      // Proportional reversal: refundedAmount / order total → same ratio of the
      // earning (capped at a full reversal). If the source order is missing
      // (manual earning), fall back to min(earning, refundedAmount).
      const orderRow = await this.prisma.order.findUnique({
        where: { id: earning.orderId },
        select: { total: true },
      });
      if (!orderRow) {
        amount = refund.lt(earningAmount) ? refund : earningAmount;
      } else {
        const orderTotal = new Prisma.Decimal(orderRow.total);
        let ratio = orderTotal.gt(0)
          ? refund.div(orderTotal)
          : new Prisma.Decimal(1);
        if (ratio.gt(1)) ratio = new Prisma.Decimal(1);
        amount = earningAmount.mul(ratio);
        if (amount.gt(earningAmount)) amount = earningAmount;
      }
      amount = amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    } else {
      amount = earningAmount;
    }

    return this.prisma.commissionReversal.create({
      data: {
        commissionEarningId: earning.id,
        orderId: dto.orderId ?? null,
        amount,
        reason: dto.reason.trim(),
        refundedAmount: dto.refundedAmount ?? null,
        reversedById: actorId ?? null,
      },
    });
  }

  // ORDER-HOOK entry: reverse every approved earning tied to an order when the
  // order is cancelled / refunded / returned. Purely additive + resilient —
  // nothing here can break the order flow (callers also wrap this in try/catch).
  async reverseForOrder(
    orderId: string,
    refundAmount?: number,
    reason = 'Order reversed',
  ): Promise<{ reversed: number; already: number }> {
    let earnings: { id: string }[] = [];
    try {
      earnings = await this.prisma.commissionEarning.findMany({
        where: { orderId, status: LedgerStatus.approved },
        select: { id: true },
      });
    } catch (err) {
      this.logger.warn(
        `Commission reversal lookup failed for order ${orderId}:`,
        err,
      );
      return { reversed: 0, already: 0 };
    }

    let reversed = 0;
    let already = 0;
    for (const earning of earnings) {
      try {
        await this.reverseEarning(
          earning.id,
          {
            orderId,
            reason,
            ...(refundAmount != null ? { refundedAmount: refundAmount } : {}),
          },
          undefined,
        );
        reversed += 1;
      } catch (err) {
        // Already-reversed (idempotent) → count as already; anything else is
        // logged and skipped so the order flow is never blocked.
        already += 1;
        this.logger.warn(
          `Commission reversal skipped for earning ${earning.id} on order ${orderId}:`,
          err,
        );
      }
    }
    return { reversed, already };
  }

  // Idempotent: re-running for the same order only ever creates one earning per
  // rule because of the unique (orderId, ruleId) constraint + skipDuplicates.
  // Errors are swallowed (logged) so order hooks never break the order flow.
  async processOrderCommissions(orderId: string): Promise<number> {
    try {
      const order = await this.prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.trashedAt) return 0;

      const confirmedId = await this.resolveConfirmedStatusId();
      if (!confirmedId) return 0;

      const rules = await this.prisma.commissionRule.findMany({
        where: {
          isActive: true,
          OR: [
            { triggerStatusId: null },
            { triggerStatusId: order.statusId },
          ],
        },
      });

      const matching = rules.filter((r) => {
        if (r.triggerStatusId === null) {
          // null trigger = default; applies only to Confirmed orders.
          return order.statusId === confirmedId;
        }
        return r.triggerStatusId === order.statusId;
      });

      if (matching.length === 0) return 0;

      const orderTotal = new Prisma.Decimal(order.total);
      const rows: Prisma.CommissionEarningCreateManyInput[] = [];

      for (const r of matching) {
        if (
          r.minOrderAmount !== null &&
          orderTotal.lt(new Prisma.Decimal(r.minOrderAmount))
        ) {
          continue;
        }

        let amt =
          r.amountType === 'fixed'
            ? new Prisma.Decimal(r.amount)
            : orderTotal
                .mul(new Prisma.Decimal(r.amount))
                .div(100);

        if (r.capPerOrder !== null) {
          const cap = new Prisma.Decimal(r.capPerOrder);
          if (amt.gt(cap)) amt = cap;
        }

        if (amt.lte(0)) continue;

        rows.push({
          employeeId: r.employeeId,
          ruleId: r.id,
          orderId,
          amount: amt,
          status: LedgerStatus.approved,
        });
      }

      if (rows.length === 0) return 0;

      await this.prisma.commissionEarning.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return rows.length;
    } catch (err) {
      this.logger.error(
        `Commission processing failed for order ${orderId}:`,
        err,
      );
      return 0;
    }
  }
}
