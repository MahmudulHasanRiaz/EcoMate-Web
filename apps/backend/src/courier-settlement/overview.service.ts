// ── Read models (§3, §14.4): overview KPIs + invoice list + waterfall.
//
// Stock balances (COD Outstanding) use CURRENT effective values; flow KPIs
// (Settled This Period, Courier Cost) use effective values dated at the
// settlement event, so a closed period is never restated.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from './accounting/courier-accounting';
import { codPosition, outstandingCod, payableToCourier } from './economics';
import { FINALIZED_INVOICE_STATES } from './cost-projection';

/** Analyzed-but-not-imported: resumable drafts, invisible to the normal list. */
export const DRAFT_INVOICE_STATES = ['UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED'];

export interface InvoiceListQuery {
  page?: number;
  limit?: number;
  state?: string;
  draft?: boolean;
  courier?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface BalanceQuery {
  from?: string;
  to?: string;
  courier?: string;
}

const FINALIZED = [...FINALIZED_INVOICE_STATES];

@Injectable()
export class CourierSettlementOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async listInvoices(query: InvoiceListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const where: Record<string, unknown> = {};
    if (query.draft === true) {
      where.state = { in: DRAFT_INVOICE_STATES };
    } else if (query.state) {
      where.state = query.state;
    }
    if (query.courier) where.courier = query.courier;
    if (query.search) {
      where.OR = [
        { displayId: { contains: query.search, mode: 'insensitive' } },
        { invoiceNo: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.from || query.to) {
      where.invoiceDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.courierSettlementInvoice.count({ where }),
      this.prisma.courierSettlementInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          displayId: true,
          courier: true,
          provider: true,
          invoiceNo: true,
          invoiceDate: true,
          rowCount: true,
          state: true,
          accountingStatus: true,
          effectiveTotals: true,
          isRevision: true,
          finalizedAt: true,
          createdAt: true,
          _count: { select: { exceptions: true } },
        },
      }),
    ]);

    return {
      data: items.map((i) => ({
        ...i,
        effectiveTotals: i.effectiveTotals ?? null,
        openExceptions: i._count.exceptions,
      })),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getOverview(query: InvoiceListQuery) {
    const from = query.from ? new Date(query.from) : startOfMonth(new Date());
    const to = query.to ? new Date(query.to) : new Date();

    const [byState, exceptionCounts] = await Promise.all([
      this.prisma.courierSettlementInvoice.groupBy({ by: ['state'], _count: { _all: true } }),
      this.prisma.courierSettlementException.groupBy({
        by: ['severity', 'status'],
        _count: { _all: true },
      }),
    ]);

    // Flow: settled this period from finalized rows whose invoice finalized in
    // range. Aggregated in the DB — loading every contributing row scales with
    // total history, not with the answer size (§14/§16).
    const flowWhere = {
      supersededByRowId: null,
      rowClass: 'DATA' as const,
      invoice: { state: { in: FINALIZED }, finalizedAt: { gte: from, lte: to } },
    };
    const [flowSums, flowPositive, flowNegative] = await Promise.all([
      this.prisma.courierSettlementRow.aggregate({
        where: flowWhere,
        _sum: { effectiveCollected: true, effectiveCharges: true, effectiveNet: true },
      }),
      this.prisma.courierSettlementRow.aggregate({
        where: { ...flowWhere, effectiveNet: { gt: 0 } },
        _sum: { effectiveNet: true },
      }),
      this.prisma.courierSettlementRow.aggregate({
        where: { ...flowWhere, effectiveNet: { lt: 0 } },
        _sum: { effectiveNet: true },
      }),
    ]);
    const collected = round2(num(flowSums._sum.effectiveCollected));
    const charges = round2(num(flowSums._sum.effectiveCharges));
    const net = round2(num(flowSums._sum.effectiveNet));
    const cashReceived = round2(num(flowPositive._sum.effectiveNet));
    const cashDisbursed = round2(-num(flowNegative._sum.effectiveNet));

    const shippingCharge = await this.prisma.order.aggregate({
      where: { courierSettlementRows: { some: { supersededByRowId: null, invoice: { state: { in: FINALIZED } } } } },
      _sum: { shippingCharge: true },
    });
    const shippingMargin = round2(num(shippingCharge._sum.shippingCharge) - charges);

    const balances = await this.getBalances(query);

    return {
      range: { from, to },
      kpis: {
        settledThisPeriod: {
          net: round2(cashReceived - cashDisbursed),
          cashReceived,
          cashDisbursed,
        },
        courierCost: charges,
        shippingMargin,
        codOutstanding: balances.kpis.outstandingCod,
        awaitingSettlement: balances.kpis.awaitingSettlement,
        exceptions: {
          red: exceptionCounts.filter((e) => e.severity === 'red').reduce((s, e) => s + e._count._all, 0),
          yellow: exceptionCounts.filter((e) => e.severity === 'yellow').reduce((s, e) => s + e._count._all, 0),
          open: exceptionCounts.filter((e) => e.status === 'open').reduce((s, e) => s + e._count._all, 0),
        },
      },
      waterfall: { expected: collected, collected, charges, net, cashReceived, cashDisbursed },
      invoicesByState: Object.fromEntries(byState.map((s) => [s.state, s._count._all])),
      // Stock vs flow invariant: current effective == Σ over all periods.
      invariant: await this.verifyFlowInvariant(charges),
    };
  }

  /** COD Outstanding + Awaiting Settlement + payable (§3). */
  async getBalances(query: BalanceQuery) {
    const where: Record<string, unknown> = {
      paymentOptionType: 'CASH_ON_DELIVERY',
      trashedAt: null,
      NOT: { status: { name: 'Cancelled' } },
    };
    if (query.courier) where.dispatches = { some: { courier: query.courier } };

    const orders = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        displayId: true,
        total: true,
        payments: { select: { amount: true, status: true, appliedCreditAmount: true } },
        status: { select: { name: true } },
        courierSettlementRows: {
          where: { supersededByRowId: null, rowClass: 'DATA', invoice: { state: { in: FINALIZED } } },
          select: { effectiveCollected: true, effectiveCharges: true, effectiveNet: true, invoiceId: true },
        },
      },
      take: 5000,
    });

    let outstandingCodTotal = 0;
    let payableTotal = 0;
    let awaitingSettlement = 0;
    let collectedNotRemitted = 0;
    let notYetCollected = 0;

    const perOrder = orders.map((o) => {
      const expected = expectedCodOf(o);
      const rows = o.courierSettlementRows;
      const collected = round2(rows.reduce((s, r) => s + num(r.effectiveCollected), 0));
      const charges = round2(rows.reduce((s, r) => s + num(r.effectiveCharges), 0));
      const net = round2(rows.reduce((s, r) => s + num(r.effectiveNet), 0));
      const pos = codPosition({ expectedCod: expected, charges, netCashMovement: net });
      const outstanding = outstandingCod(pos);
      const payable = payableToCourier(pos);

      outstandingCodTotal = round2(outstandingCodTotal + outstanding);
      payableTotal = round2(payableTotal + payable);
      if (rows.length === 0) {
        awaitingSettlement = round2(awaitingSettlement + expected);
      }
      notYetCollected = round2(notYetCollected + Math.max(expected - collected, 0));
      collectedNotRemitted = round2(collectedNotRemitted + Math.max(collected - charges - net, 0));

      return {
        orderId: o.id,
        displayId: o.displayId,
        expectedCod: expected,
        collected,
        charges,
        net,
        codPosition: pos,
        outstandingCod: outstanding,
        payableToCourier: payable,
        settlementRows: rows.length,
      };
    });

    return {
      kpis: { outstandingCod: outstandingCodTotal, payableToCourier: payableTotal, awaitingSettlement },
      buckets: { notYetCollected, collectedNotRemitted },
      orders: perOrder.filter((o) => o.outstandingCod > 0 || o.codPosition < 0 || o.settlementRows > 0),
    };
  }

  /** Σ over all finalized periods must equal the current effective cost. */
  private async verifyFlowInvariant(periodCharges: number) {
    const agg = await this.prisma.courierSettlementRow.aggregate({
      where: { supersededByRowId: null, rowClass: 'DATA', invoice: { state: { in: FINALIZED } } },
      _sum: { effectiveCharges: true },
    });
    const current = round2(num(agg._sum.effectiveCharges));
    return {
      currentEffectiveCharges: current,
      periodCharges,
      equal: Math.abs(current - periodCharges) < 1e-6,
    };
  }
}

function expectedCodOf(order: {
  total: unknown;
  payments: { amount: unknown; status: string; appliedCreditAmount?: unknown }[];
}): number {
  // D-C actuals-only ledger: derived due (total − ΣPAID − ΣappliedCredit),
  // floored at 0 — mirrors CodMismatchService systemDue, never a cash-row sum.
  const paid = order.payments
    .filter((p) => p.status === 'PAID')
    .reduce((s, p) => s + num(p.amount), 0);
  const applied = order.payments.reduce((s, p) => s + num(p.appliedCreditAmount), 0);
  return Math.max(0, round2(num(order.total) - paid - applied));
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}