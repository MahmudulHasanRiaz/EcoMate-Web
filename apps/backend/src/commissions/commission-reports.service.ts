import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dhakaStartOfDay } from '../hr-attendance/attendance-date';

/**
 * Read models over the commission ledger.
 *
 * Everything here reads the ledger, never re-scans the order table. The ledger
 * is written once per qualifying event, so a report is an aggregate over
 * indexed rows rather than a walk of historical orders.
 */
@Injectable()
export class CommissionReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-employee totals with a breakdown by purpose, plus paid/unpaid split.
   */
  async summary(query: {
    employeeId?: string;
    departmentId?: string;
    from?: string;
    to?: string;
  }) {
    const where = await this.buildWhere(query);

    const [byEmployee, byPurpose] = await Promise.all([
      this.prisma.commissionLedgerV2.groupBy({
        by: ['employeeId'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.commissionLedgerV2.groupBy({
        by: ['employeeId', 'purpose'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.commissionLedgerV2.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    const employeeIds = [...new Set(byEmployee.map((r) => r.employeeId))];
    if (employeeIds.length === 0) {
      return { data: [], totals: emptyTotals() };
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        employeeId: true,
        betterAuthUser: { select: { name: true, image: true } },
        department: { select: { name: true } },
      },
    });
    const byId = new Map(employees.map((e) => [e.id, e]));

    // Paid vs unpaid: a ledger row claimed by a payslip has been paid.
    const paidAgg = await this.prisma.commissionLedgerV2.groupBy({
      by: ['employeeId'],
      where: { ...where, payslipId: { not: null } },
      _sum: { amount: true },
    });
    const paidMap = new Map(paidAgg.map((r) => [r.employeeId, Number(r._sum.amount ?? 0)]));

    const rows = byEmployee.map((r) => {
      const emp = byId.get(r.employeeId);
      const purposes = byPurpose
        .filter((p) => p.employeeId === r.employeeId)
        .map((p) => ({
          purpose: p.purpose,
          amount: round2(Number(p._sum.amount ?? 0)),
          count: p._count._all,
        }))
        .sort((a, b) => a.purpose.localeCompare(b.purpose));

      const total = round2(Number(r._sum.amount ?? 0));
      const paid = round2(paidMap.get(r.employeeId) ?? 0);

      return {
        employeeId: r.employeeId,
        employeeCode: emp?.employeeId ?? null,
        name: emp?.betterAuthUser?.name ?? 'Unknown',
        avatar: emp?.betterAuthUser?.image ?? null,
        department: emp?.department?.name ?? null,
        totalEarned: total,
        paid,
        unpaid: round2(total - paid),
        earningCount: r._count._all,
        byPurpose: purposes,
      };
    });

    const totalEarned = round2(rows.reduce((s, r) => s + r.totalEarned, 0));
    const totalPaid = round2(rows.reduce((s, r) => s + r.paid, 0));

    return {
      data: rows.sort((a, b) => b.totalEarned - a.totalEarned),
      totals: {
        totalEarned,
        totalPaid,
        totalUnpaid: round2(totalEarned - totalPaid),
        employeeCount: rows.length,
      },
    };
  }

  /**
   * Per-employee totals grouped by the rule that produced them.
   */
  async byRule(query: { employeeId?: string; from?: string; to?: string }) {
    const where = await this.buildWhere(query);

    const grouped = await this.prisma.commissionLedgerV2.groupBy({
      by: ['ruleId', 'purpose'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });

    if (grouped.length === 0) return { data: [], totals: emptyTotals() };

    const ruleIds = [...new Set(grouped.map((g) => g.ruleId))];
    const rules = await this.prisma.commissionRuleV2.findMany({
      where: { id: { in: ruleIds } },
      select: {
        id: true,
        name: true,
        employeeId: true,
        amountType: true,
        amount: true,
        employee: { select: { betterAuthUser: { select: { name: true } } } },
      },
    });
    const ruleMap = new Map(rules.map((r) => [r.id, r]));

    const data = grouped.map((g) => {
      const rule = ruleMap.get(g.ruleId);
      return {
        ruleId: g.ruleId,
        ruleName: rule?.name ?? null,
        employeeId: rule?.employeeId ?? null,
        employeeName: rule?.employee?.betterAuthUser?.name ?? 'Unknown',
        purpose: g.purpose,
        ruleAmount: rule ? Number(rule.amount) : null,
        amountType: rule?.amountType ?? null,
        amount: round2(Number(g._sum.amount ?? 0)),
        count: g._count._all,
      };
    });

    return {
      data: data.sort((a, b) => b.amount - a.amount),
      totals: {
        totalEarned: round2(data.reduce((s, r) => s + r.amount, 0)),
      },
    };
  }

  /**
   * A single earning with everything needed to answer "why was this paid?".
   *
   * The rule's CURRENT values are deliberately not shown as the basis: the
   * ledger carries a snapshot taken at credit time, and that snapshot is what
   * the money was actually calculated from.
   */
  async earningDetail(ledgerId: string) {
    const row = await this.prisma.commissionLedgerV2.findUnique({
      where: { id: ledgerId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            betterAuthUser: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        order: {
          select: {
            id: true,
            displayId: true,
            total: true,
            subtotal: true,
            status: { select: { name: true } },
          },
        },
        transition: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            actorUserId: true,
            occurredAt: true,
            isFirstForStatus: true,
          },
        },
        reversals: {
          select: { id: true, amount: true, reason: true, refundedAmount: true, reversedAt: true },
        },
      },
    });

    if (!row) return null;

    const rule = await this.prisma.commissionRuleV2.findUnique({
      where: { id: row.ruleId },
      select: { id: true, name: true, amount: true, amountType: true, isActive: true },
    });

    const reversed = round2(row.reversals.reduce((s, r) => s + Number(r.amount), 0));

    return {
      id: row.id,
      employee: {
        id: row.employee.id,
        employeeCode: row.employee.employeeId,
        name: row.employee.betterAuthUser?.name ?? 'Unknown',
        department: row.employee.department?.name ?? null,
      },
      order: {
        id: row.order.id,
        displayId: row.order.displayId,
        total: Number(row.order.total),
        subtotal: Number(row.order.subtotal),
        status: row.order.status?.name ?? null,
      },
      purpose: row.purpose,
      // Why it qualified, in the manager's terms.
      qualification: {
        isFirstActor: row.transition.isFirstForStatus,
        transitionFrom: row.transition.fromStatus,
        transitionTo: row.transition.toStatus,
        actorUserId: row.transition.actorUserId,
        qualifiedAt: row.qualifiedAt,
        threshold: row.minimumCount
          ? {
              required: row.minimumCount,
              period: row.thresholdPeriod,
              countAtQualification: row.countAtQualification,
              periodKey: row.periodKey,
            }
          : null,
      },
      // The snapshot actually used for the arithmetic.
      calculation: {
        amountType: row.amountType,
        ruleAmountAtTime: Number(row.ruleAmount),
        valueBasis: row.valueBasis,
        sourceAmount: Number(row.sourceAmount),
        capApplied: row.capApplied,
        amount: Number(row.amount),
      },
      rule: rule
        ? { id: rule.id, name: rule.name, currentAmount: Number(rule.amount), isActive: rule.isActive }
        : null,
      status: row.status,
      payslipId: row.payslipId,
      reversed,
      net: round2(Number(row.amount) - reversed),
      reversals: row.reversals.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        reason: r.reason,
        refundedAmount: r.refundedAmount !== null ? Number(r.refundedAmount) : null,
        reversedAt: r.reversedAt,
      })),
      createdAt: row.createdAt,
    };
  }

  /**
   * Order-level drilldown for one employee and purpose within a range.
   */
  async drilldown(query: {
    employeeId: string;
    purpose?: string;
    from?: string;
    to?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const perPage = Math.min(query.perPage && query.perPage > 0 ? query.perPage : 20, 100);

    const where: Prisma.CommissionLedgerV2WhereInput = {
      employeeId: query.employeeId,
      ...(query.purpose ? { purpose: query.purpose } : {}),
    };
    await this.applyDateRange(where, query.from, query.to);

    const [rows, total, sum] = await Promise.all([
      this.prisma.commissionLedgerV2.findMany({
        where,
        select: {
          id: true,
          orderId: true,
          purpose: true,
          amount: true,
          qualifiedAt: true,
          status: true,
          order: { select: { displayId: true, total: true, status: { select: { name: true } } } },
        },
        orderBy: { qualifiedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.commissionLedgerV2.count({ where }),
      this.prisma.commissionLedgerV2.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      data: rows.map((r) => ({
        ledgerId: r.id,
        orderId: r.orderId,
        displayId: r.order.displayId,
        orderTotal: Number(r.order.total),
        orderStatus: r.order.status?.name ?? null,
        purpose: r.purpose,
        amount: Number(r.amount),
        qualifiedAt: r.qualifiedAt,
        status: r.status,
      })),
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        totalAmount: round2(Number(sum._sum.amount ?? 0)),
      },
    };
  }

  /** Period-over-period trend for the dashboard. */
  async trend(query: { employeeId?: string; from?: string; to?: string; days?: number }) {
    const days = Math.min(query.days ?? 30, 365);
    const to = query.to ? dhakaStartOfDay(query.to) : new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);

    const rows = await this.prisma.commissionLedgerV2.findMany({
      where: {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        qualifiedAt: { gte: from, lte: to },
      },
      select: { amount: true, qualifiedAt: true, periodKey: true },
    });

    // Bucket by the stored periodKey so the chart matches the ledger exactly
    // rather than re-deriving dates in the view.
    const buckets = new Map<string, number>();
    for (const r of rows) {
      const key = r.periodKey || r.qualifiedAt.toISOString().slice(0, 10);
      buckets.set(key, round2((buckets.get(key) ?? 0) + Number(r.amount)));
    }

    return {
      data: [...buckets.entries()].map(([periodKey, amount]) => ({ periodKey, amount })).sort((a, b) => a.periodKey.localeCompare(b.periodKey)),
      totals: { totalEarned: round2(rows.reduce((s, r) => s + Number(r.amount), 0)) },
    };
  }

  private async buildWhere(query: {
    employeeId?: string;
    departmentId?: string;
    from?: string;
    to?: string;
  }): Promise<Prisma.CommissionLedgerV2WhereInput> {
    const where: Prisma.CommissionLedgerV2WhereInput = {};

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.departmentId) {
      const staff = await this.prisma.employee.findMany({
        where: { departmentId: query.departmentId },
        select: { id: true },
      });
      where.employeeId = { in: staff.map((s) => s.id) };
    }

    await this.applyDateRange(where, query.from, query.to);
    return where;
  }

  private async applyDateRange(
    where: Prisma.CommissionLedgerV2WhereInput,
    from?: string,
    to?: string,
  ) {
    if (from) {
      where.qualifiedAt = { ...(where.qualifiedAt as object), gte: dhakaStartOfDay(from) };
    }
    if (to) {
      // Inclusive of the whole `to` day.
      where.qualifiedAt = {
        ...(where.qualifiedAt as object),
        lte: new Date(dhakaStartOfDay(to).getTime() + 86400000 - 1),
      };
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyTotals() {
  return { totalEarned: 0, totalPaid: 0, totalUnpaid: 0, employeeCount: 0 };
}