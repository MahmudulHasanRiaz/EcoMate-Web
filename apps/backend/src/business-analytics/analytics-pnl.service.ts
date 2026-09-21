/**
 * Business analytics P&L service (P2 data layer, §2.5 ladder + §2.11 bridge).
 *
 * Delivered-only recognition per metric-contract (never duplicated here).
 * Gross Sales = Σ price×qty ONLY — Order.shippingCharge is never inside;
 * Order.total is read ONLY for the L1 Booked lens (intake), never for the
 * ladder; Order.paymentStatus is never a settlement input (D11).
 *
 * Date bases: revenue → Delivered transition (Dispatch.deliveredAt fallback);
 * returns → return transition; refunds → processedAt ?? createdAt; marketing →
 * spendDate ONLY (allocatedAt never); expenses → expenseDate; gateway fees →
 * the recognised order cohort (cost follows its revenue).
 */
import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  resolveRevenueEvent,
  resolveReturn,
  allocateDiscount,
  classifyRefund,
  cogsLineState,
  fulfillmentCostState,
  marketingPeriodCost,
  inferDeliveryChargeRetained,
  computeContributionProfit,
  computeFulfillmentMargin,
  computeTotalBusinessContribution,
  computeNetProfit,
  computeOperatingProfit,
  computeNetProfitFromLedger,
  computeMargin,
  OTHER_COSTS_STATE,
  type CostState,
  type TimelineEntry,
  type MarketingConsumptionRow,
} from './metric-contract';
import { ladderState } from './analytics-coverage.util';
import { collectionKindOf } from './settlement-source';
import {
  AnalyticsFilterService,
  customerKeyOf,
  deriveCustomerSegments,
  type ResolvedAnalyticsContext,
} from './analytics-filter.service';
import type { AnalyticsFilterDto } from './analytics-filter.dto';
import {
  kpiOk,
  kpiZero,
  kpiNoData,
  kpiNotApplicable,
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  type KpiValue,
  type AnalyticsMeta,
} from './analytics-envelope.util';

// ---------------------------------------------------------------------------
// Pure inputs (Prisma rows mapped to plain numbers before entry).
// ---------------------------------------------------------------------------

export interface PnlItemInput {
  price: number;
  quantity: number;
  costSnapshot: number | null;
  costType: 'actual' | 'estimated' | null;
}

export interface PnlPaymentInput {
  amount: number;
  status: string;
  gatewayCode: string;
  feeAmount?: number | null;
  createdAt: Date;
}

export interface PnlRefundInput {
  amount: number;
  status: string;
  processedAt?: Date | null;
  createdAt: Date;
}

export interface PnlOrderInput {
  id: string;
  total: number;
  subtotal: number;
  shippingCharge: number;
  discount: number;
  discountType: 'flat' | 'percentage';
  status: string;
  timeline: TimelineEntry[];
  dispatchDeliveredAt?: Date | null;
  createdAt?: Date;
  paymentOptionType?: string | null;
  customerId?: string | null;
  customerPhone?: string | null;
  guestPhone?: string | null;
  shippingCost?: number | null;
  shippingCostSource?: 'manual' | 'courier_default' | null;
  items: PnlItemInput[];
  payments: PnlPaymentInput[];
  refunds: PnlRefundInput[];
}

export interface PnlInput {
  range: { start: Date; end: Date };
  /** Recognised-candidate set: non-trashed orders matching column filters. */
  orders: PnlOrderInput[];
  bookedOrders: { createdAt: Date; total: number }[];
  /** PAID payments by createdAt (L3). */
  cashPayments: PnlPaymentInput[];
  consumptions: (MarketingConsumptionRow & { allocatedAt?: Date })[];
  expenses: { amount: number; taxAmount: number; expenseDate: Date }[];
}

export interface PnlResult {
  recognisedOrders: number;
  grossSales: { amount: number };
  discounts: { amount: number };
  returns: { amount: number };
  refundsReversal: { amount: number };
  informationalRefunds: number;
  returnEvents: number;
  netSales: { amount: number };
  cogs: { amount: number; state: CostState };
  returnedCogs: { amount: number };
  grossProfit: { amount: number };
  fulfillmentCost: { amount: number; state: CostState };
  paymentFees: { amount: number; state: CostState };
  marketingCost: { amount: number; state: CostState };
  contributionProfit: { amount: number };
  operatingExpenses: { amount: number };
  operatingProfit: { amount: number };
  otherCosts: { value: null; state: CostState };
  netProfit: { amount: number };
  margins: {
    gross: number | null;
    contribution: number | null;
    operating: number | null;
    net: number | null;
  };
  coverage: {
    cogs: {
      actualPct: number;
      estimatedPct: number;
      unavailableUnits: number;
      unavailableItems: number;
    };
    shipping: { actualOrders: number; estimatedOrders: number; unavailableOrders: number };
    fees: { paidPayments: number; withFee: number; withoutFee: number };
    marketing: { datedRows: number; undatedRows: number; datedAmount: number; undatedAmount: number };
    delivery: { onlineOrders: number; codOrders: number; collectionUnavailableOrders: number };
  };
  bridge: {
    contributionProfit: number;
    deliveryChargeRetained: number;
    deliveryChargeRetainedState: 'actual' | 'unavailable';
    fulfillmentMargin: number;
    totalBusinessContribution: number;
    operatingProfit: number;
    netProfit: number;
    /** Structural R15 guard: FM is never an operand. */
    operands: ['contributionProfit', 'deliveryChargeRetained'];
    codRecognisedOrders: number;
    excludedCodShippingCharge: number;
    shippingRefundInferences: number;
  };
  lenses: { booked: number; recognised: number; cashCollected: number };
  strip: {
    bookedOrders: number;
    bookedAmount: number;
    recognised: number;
    inFulfilment: number;
    delivered: number;
    notYetRecognised: number;
    recognitionRate: number | null;
    dateSourceMix: { timeline: number; dispatch: number };
    undatedDeliveries: number;
  };
}

function inRange(at: Date | null, range: { start: Date; end: Date }): boolean {
  return at !== null && at >= range.start && at <= range.end;
}

export function computePnl(input: PnlInput): PnlResult {
  const { range } = input;
  let recognisedOrders = 0;
  let gross = 0;
  let discounts = 0;
  let returns = 0;
  let refundsReversal = 0;
  let informationalRefunds = 0;
  let returnEvents = 0;
  let cogs = 0;
  let returnedCogs = 0;
  let cogsActualUnits = 0;
  let cogsEstimatedUnits = 0;
  let cogsUnavailableUnits = 0;
  let cogsUnavailableItems = 0;
  let fulfillment = 0;
  let shipActual = 0;
  let shipEstimated = 0;
  let shipUnavailable = 0;
  let fees = 0;
  let feesState: 'actual' | 'unavailable' = 'actual';
  let paidPayments = 0;
  let withFee = 0;
  let withoutFee = 0;
  let dcr = 0;
  let codRecognised = 0;
  let excludedCodShipping = 0;
  let inferences = 0;
  let onlineRecognised = 0;
  let codRecognisedDelivery = 0;
  let dateTimeline = 0;
  let dateDispatch = 0;
  let undated = 0;
  let deliveredInRange = 0;
  let inFulfilment = 0;
  let notYetRecognised = 0;

  for (const order of input.orders) {
    const rev = resolveRevenueEvent({
      timeline: order.timeline ?? [],
      dispatchDeliveredAt: order.dispatchDeliveredAt ?? null,
      currentStatus: order.status,
    });
    if (rev.undatedDelivery) undated += 1;

    const ret = resolveReturn(
      order.timeline ?? [],
      rev.revenueDate,
    );

    // Event-dated lines (returns + refund reversals) belong to the period of
    // the EVENT, not the revenue period: a delivery-recognised order returned
    // or refunded in range reverses here even when delivered earlier (P1 is
    // never rewritten).
    const recognisedEver = rev.recognised;
    const inCohort =
      recognisedEver && inRange(rev.revenueDate, range);

    const lineGrosses = order.items.map((i) => i.price * i.quantity);
    const grossSum = lineGrosses.reduce((s, g) => s + g, 0);
    const effectiveDiscount =
      order.discountType === 'percentage'
        ? order.subtotal * (order.discount / 100)
        : order.discount;
    const allocated = allocateDiscount(lineGrosses, effectiveDiscount);
    const lineNets = allocated.map((a) => a.net);

    if (recognisedEver) {
      if (ret.reversesRevenue && inRange(ret.returnAt, range)) {
        returnEvents += 1;
        returns += lineNets.reduce((s, n) => s + n, 0);
        for (const item of order.items) {
          if (item.costSnapshot !== null && item.costSnapshot !== undefined) {
            returnedCogs += item.costSnapshot * item.quantity;
          }
        }
      }
      // A dated return already takes the reversal (in whichever period it
      // landed); a later refund is informational only. An undated return
      // takes nothing, so a dated refund is the reversal (D7, R12).
      const wasReturned = ret.reversesRevenue && ret.returnAt !== null;
      for (const refund of order.refunds) {
        if (refund.status !== 'completed') continue;
        const treatment = classifyRefund({ wasDelivered: true, wasReturned });
        const at = refund.processedAt ?? refund.createdAt;
        if (treatment === 'reversal') {
          if (inRange(at, range)) refundsReversal += refund.amount;
        } else if (treatment === 'informational') {
          if (inRange(at, range)) informationalRefunds += refund.amount;
        }
      }
    } else {
      // Never delivered: not a reversal (nothing was recognised), but the
      // completed refund still counts in Total Refunds (informational), which
      // covers ALL completed refunds. It lives in Fulfillment Economics.
      for (const refund of order.refunds) {
        if (refund.status !== 'completed') continue;
        const at = refund.processedAt ?? refund.createdAt;
        if (inRange(at, range)) informationalRefunds += refund.amount;
      }
    }

    if (!inCohort) {
      // Pipeline accounting for the recognition strip (snapshot over the
      // candidate set; cancelled orders are simply not in fulfilment).
      if (!recognisedEver && !rev.undatedDelivery && order.status !== 'Cancelled') {
        inFulfilment += 1;
      }
      if (
        order.createdAt &&
        order.createdAt >= range.start &&
        order.createdAt <= range.end &&
        !recognisedEver
      ) {
        notYetRecognised += 1;
      }
      continue;
    }

    recognisedOrders += 1;
    if (rev.revenueDateSource === 'timeline') dateTimeline += 1;
    if (rev.revenueDateSource === 'dispatch') dateDispatch += 1;
    const deliveredTransition = (order.timeline ?? []).some(
      (e) =>
        e.status === 'Delivered' &&
        inRange(
          (() => {
            const d = new Date(e.timestamp);
            return Number.isNaN(d.getTime()) ? null : d;
          })(),
          range,
        ),
    );
    if (deliveredTransition) deliveredInRange += 1;

    gross += grossSum;
    discounts += allocated.reduce((s, a) => s + a.allocated, 0);

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      const state = cogsLineState({
        costSnapshot: item.costSnapshot,
        costType: item.costType,
      });
      if (item.costSnapshot !== null && item.costSnapshot !== undefined) {
        cogs += item.costSnapshot * item.quantity;
        if (state === 'actual') cogsActualUnits += item.quantity;
        else cogsEstimatedUnits += item.quantity;
      } else {
        // Unavailable units are counted, never summed as zero; the current
        // standardCost is never consulted (no back-fill, §2.3).
        cogsUnavailableUnits += item.quantity;
        cogsUnavailableItems += 1;
      }
      void lineNets;
    }

    const shipState = fulfillmentCostState({
      shippingCost: order.shippingCost ?? null,
      shippingCostSource: order.shippingCostSource ?? null,
    });
    fulfillment += order.shippingCost ?? 0;
    if (shipState === 'actual') shipActual += 1;
    else if (shipState === 'estimated') shipEstimated += 1;
    else shipUnavailable += 1;

    for (const payment of order.payments) {
      if (payment.status !== PaymentStatus.PAID) continue;
      paidPayments += 1;
      if (payment.feeAmount !== null && payment.feeAmount !== undefined) {
        fees += payment.feeAmount;
        withFee += 1;
      } else {
        withoutFee += 1;
        feesState = 'unavailable';
      }
    }

    const kind = collectionKindOf(order.paymentOptionType);
    if (kind === 'online') {
      onlineRecognised += 1;
      const refundTotal = order.refunds
        .filter((r) => r.status === 'completed')
        .reduce((s, r) => s + r.amount, 0);
      const outcome = inferDeliveryChargeRetained({
        shippingCharge: order.shippingCharge,
        refundAmount: refundTotal,
        collection: 'online',
      });
      dcr += outcome.retained ?? 0;
      if (outcome.inference !== 'none') inferences += 1;
    } else {
      codRecognised += 1;
      codRecognisedDelivery += 1;
      excludedCodShipping += order.shippingCharge;
    }
    void codRecognisedDelivery;
  }

  const netSales = gross - discounts - returns - refundsReversal;
  const cogsNet = cogs - returnedCogs;
  const grossProfit = netSales - cogsNet;

  const cogsState =
    cogsUnavailableUnits > 0
      ? 'unavailable'
      : cogsEstimatedUnits > 0
        ? 'estimated'
        : 'actual';
  const shipStateAgg =
    shipUnavailable > 0 ? 'unavailable' : shipEstimated > 0 ? 'estimated' : 'actual';

  const marketing = marketingPeriodCost(input.consumptions, range.start, range.end);

  let opex = 0;
  for (const expense of input.expenses) {
    if (inRange(expense.expenseDate, range)) {
      opex += expense.amount + expense.taxAmount;
    }
  }

  const contributionProfit = computeContributionProfit({
    netSales,
    cogs: cogsNet,
    courierCost: fulfillment,
    paymentFees: fees,
    marketingCost: marketing.total,
  });
  const dcrState = codRecognised > 0 ? 'unavailable' : 'actual';
  const fulfillmentMargin = computeFulfillmentMargin({
    deliveryChargeRetained: dcr,
    courierCost: fulfillment,
  });
  const tbc = computeTotalBusinessContribution({
    contributionProfit,
    deliveryChargeRetained: dcr,
  });
  const operatingProfit = computeOperatingProfit({
    totalBusinessContribution: tbc,
    operatingExpenses: opex,
  });
  const netProfit = computeNetProfit({
    totalBusinessContribution: tbc,
    operatingExpenses: opex,
  });

  const booked = input.bookedOrders
    .filter((b) => b.createdAt >= range.start && b.createdAt <= range.end)
    .reduce((s, b) => s + b.total, 0);
  const cash = input.cashPayments
    .filter(
      (p) =>
        p.status === PaymentStatus.PAID &&
        p.createdAt >= range.start &&
        p.createdAt <= range.end,
    )
    .reduce((s, p) => s + p.amount, 0);

  const totalCogsUnits = cogsActualUnits + cogsEstimatedUnits + cogsUnavailableUnits;

  return {
    recognisedOrders,
    grossSales: { amount: gross },
    discounts: { amount: discounts },
    returns: { amount: returns },
    refundsReversal: { amount: refundsReversal },
    informationalRefunds,
    returnEvents,
    netSales: { amount: netSales },
    cogs: { amount: cogsNet, state: cogsState },
    returnedCogs: { amount: returnedCogs },
    grossProfit: { amount: grossProfit },
    fulfillmentCost: { amount: fulfillment, state: shipStateAgg },
    paymentFees: { amount: fees, state: feesState },
    marketingCost: { amount: marketing.total, state: marketing.state },
    contributionProfit: { amount: contributionProfit },
    operatingExpenses: { amount: opex },
    operatingProfit: { amount: operatingProfit },
    otherCosts: { value: null, state: OTHER_COSTS_STATE },
    netProfit: { amount: netProfit },
    margins: {
      gross: computeMargin({ profit: grossProfit, netSales }),
      contribution: computeMargin({ profit: contributionProfit, netSales }),
      operating: computeMargin({ profit: operatingProfit, netSales }),
      net: computeMargin({ profit: netProfit, netSales }),
    },
    coverage: {
      cogs: {
        actualPct: totalCogsUnits > 0 ? (cogsActualUnits / totalCogsUnits) * 100 : 100,
        estimatedPct:
          totalCogsUnits > 0 ? (cogsEstimatedUnits / totalCogsUnits) * 100 : 0,
        unavailableUnits: cogsUnavailableUnits,
        unavailableItems: cogsUnavailableItems,
      },
      shipping: {
        actualOrders: shipActual,
        estimatedOrders: shipEstimated,
        unavailableOrders: shipUnavailable,
      },
      fees: { paidPayments, withFee, withoutFee },
      marketing: {
        datedRows: marketing.datedRows,
        undatedRows: marketing.undatedRows,
        datedAmount: marketing.datedAmount,
        undatedAmount: marketing.undatedAmount,
      },
      delivery: {
        onlineOrders: onlineRecognised,
        codOrders: codRecognised,
        collectionUnavailableOrders: codRecognised,
      },
    },
    bridge: {
      contributionProfit,
      deliveryChargeRetained: dcr,
      deliveryChargeRetainedState: dcrState,
      fulfillmentMargin,
      totalBusinessContribution: tbc,
      operatingProfit,
      netProfit,
      operands: ['contributionProfit', 'deliveryChargeRetained'],
      codRecognisedOrders: codRecognised,
      excludedCodShippingCharge: excludedCodShipping,
      shippingRefundInferences: inferences,
    },
    lenses: { booked, recognised: netSales, cashCollected: cash },
    strip: {
      bookedOrders: input.bookedOrders.length,
      bookedAmount: booked,
      recognised: recognisedOrders,
      inFulfilment,
      delivered: deliveredInRange,
      notYetRecognised,
      recognitionRate:
        input.bookedOrders.length > 0
          ? recognisedOrders / input.bookedOrders.length
          : null,
      dateSourceMix: { timeline: dateTimeline, dispatch: dateDispatch },
      undatedDeliveries: undated,
    },
  };
}

// ---------------------------------------------------------------------------
// Expense summary (P9-owned domain; P2 exposes the company-level rollup for
// the expenses endpoint + R4/W8 wiring).
// ---------------------------------------------------------------------------

export interface ExpenseSummaryRow {
  amount: number;
  taxAmount: number;
  expenseDate: Date;
  category: { id: string; name: string; expenseKind: string };
}

export interface ExpenseSummary {
  total: number;
  byCategory: {
    categoryId: string;
    name: string;
    expenseKind: string;
    total: number;
  }[];
  byKind: { fixed: number; variable: number; unclassified: number };
}

export function summariseExpenses(
  rows: ExpenseSummaryRow[],
  range: { start: Date; end: Date },
): ExpenseSummary {
  const byCategory = new Map<
    string,
    { categoryId: string; name: string; expenseKind: string; total: number }
  >();
  const byKind = { fixed: 0, variable: 0, unclassified: 0 };
  let total = 0;
  for (const row of rows) {
    if (!(row.expenseDate >= range.start && row.expenseDate <= range.end)) {
      continue;
    }
    const amount = row.amount + row.taxAmount;
    total += amount;
    const kind =
      row.category.expenseKind === 'fixed' ||
      row.category.expenseKind === 'variable'
        ? row.category.expenseKind
        : 'unclassified';
    byKind[kind] += amount;
    const entry = byCategory.get(row.category.id) ?? {
      categoryId: row.category.id,
      name: row.category.name,
      expenseKind: row.category.expenseKind,
      total: 0,
    };
    entry.total += amount;
    byCategory.set(row.category.id, entry);
  }
  return { total, byCategory: [...byCategory.values()], byKind };
}

// ---------------------------------------------------------------------------
// Nest service: fetch (one round-trip per group) → compute → envelop.
// ---------------------------------------------------------------------------

export interface PnlLineEnvelopes {
  grossSales: KpiValue;
  discounts: KpiValue;
  returns: KpiValue;
  refundsReversal: KpiValue;
  netSales: KpiValue;
  cogs: KpiValue;
  grossProfit: KpiValue;
  fulfillmentCost: KpiValue;
  paymentFees: KpiValue;
  marketingCost: KpiValue;
  contributionProfit: KpiValue;
  operatingExpenses: KpiValue;
  operatingProfit: KpiValue;
  otherCosts: KpiValue;
  netProfit: KpiValue;
}

export interface PnlResponse {
  data: {
    lines: PnlLineEnvelopes;
    margins: PnlResult['margins'];
    bridge: PnlResult['bridge'] & { state: KpiValue['state'] };
    lenses: {
      booked: KpiValue;
      recognised: KpiValue;
      cashCollected: KpiValue;
    };
    strip: PnlResult['strip'];
    coverage: PnlResult['coverage'];
    marketing: {
      datedRows: number;
      undatedRows: number;
      datedAmount: number;
      undatedAmount: number;
      estimatedReference: { label: string; excludedFromTotal: true } | null;
    };
  };
  meta: AnalyticsMeta;
}

@Injectable()
export class AnalyticsPnlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly cache: CacheService,
  ) {}

  private money(
    amount: number,
    state: CostState,
    opts: { dateBasis: string; empty: boolean; reason?: string },
  ): KpiValue {
    if (opts.empty) return kpiNoData('no recognised orders in range');
    if (amount === 0) return kpiZero(opts.reason ?? 'measured zero');
    if (state === 'unavailable') {
      return { value: amount, state: 'unavailable', reason: opts.reason, dateBasis: opts.dateBasis };
    }
    if (state === 'estimated') {
      return { value: amount, state: 'estimated', reason: opts.reason, dateBasis: opts.dateBasis };
    }
    return kpiOk(amount, { dateBasis: opts.dateBasis });
  }

  private async buildReport(
    query: AnalyticsFilterDto,
  ): Promise<{ result: PnlResult; ctx: ResolvedAnalyticsContext }> {
    const ctx = this.filters.resolveContext(query);
    const { range, filters } = ctx;
    const marketingOrderIds = filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    const { payments: _pm, ...orderPart } = where as any;

    const [orders, booked, cash, consumptions, expenses] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          total: true,
          subtotal: true,
          shippingCharge: true,
          discount: true,
          discountType: true,
          status: { select: { name: true } },
          timeline: true,
          createdAt: true,
          paymentOptionType: true,
          customerId: true,
          customerPhone: true,
          guestPhone: true,
          shippingCost: true,
          shippingCostSource: true,
          items: {
            select: {
              price: true,
              quantity: true,
              costSnapshot: true,
              costType: true,
            },
          },
          payments: {
            select: {
              amount: true,
              status: true,
              gatewayCode: true,
              feeAmount: true,
              createdAt: true,
            },
          },
          refunds: {
            select: { amount: true, status: true, processedAt: true, createdAt: true },
          },
          dispatches: {
            select: { deliveredAt: true },
            orderBy: { deliveredAt: 'desc' },
          },
        },
      }),
      this.prisma.order.findMany({
        where: { ...where, createdAt: { gte: range.start, lte: range.end } },
        select: { createdAt: true, total: true },
      }),
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          createdAt: { gte: range.start, lte: range.end },
          ...(filters.paymentMethod ? { gatewayCode: filters.paymentMethod } : {}),
          order: orderPart,
        },
        select: { amount: true, status: true, gatewayCode: true, createdAt: true },
      }),
      this.prisma.marketingConsumption.findMany({
        select: { calculatedCost: true, spendDate: true, allocatedAt: true },
      }),
      this.prisma.expense.findMany({
        where: { expenseDate: { gte: range.start, lte: range.end } },
        select: { amount: true, taxAmount: true, expenseDate: true },
      }),
    ]);

    let candidates = orders.map((o: any): PnlOrderInput => {
      const deliveredAts = (o.dispatches ?? [])
        .map((d: any) => d.deliveredAt)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      return {
        id: o.id,
        total: Number(o.total),
        subtotal: Number(o.subtotal),
        shippingCharge: Number(o.shippingCharge),
        discount: Number(o.discount),
        discountType: o.discountType === 'percentage' ? 'percentage' : 'flat',
        status: o.status?.name ?? '',
        timeline: Array.isArray(o.timeline) ? (o.timeline as any) : [],
        dispatchDeliveredAt:
          deliveredAts.length > 0
            ? new Date(Math.max(...deliveredAts.map((d: Date) => d.getTime())))
            : null,
        createdAt: o.createdAt ? new Date(o.createdAt) : undefined,
        paymentOptionType: o.paymentOptionType,
        customerId: o.customerId,
        customerPhone: o.customerPhone,
        guestPhone: o.guestPhone,
        shippingCost: o.shippingCost === null ? null : Number(o.shippingCost),
        shippingCostSource: o.shippingCostSource,
        items: (o.items ?? []).map((i: any) => ({
          price: Number(i.price),
          quantity: i.quantity,
          costSnapshot: i.costSnapshot === null ? null : Number(i.costSnapshot),
          costType: i.costType === 'actual' || i.costType === 'estimated' ? i.costType : null,
        })),
        payments: (o.payments ?? []).map((p: any) => ({
          amount: Number(p.amount),
          status: p.status,
          gatewayCode: p.gatewayCode,
          feeAmount: p.feeAmount === null ? null : Number(p.feeAmount),
          createdAt: new Date(p.createdAt),
        })),
        refunds: (o.refunds ?? []).map((r: any) => ({
          amount: Number(r.amount),
          status: r.status,
          processedAt: r.processedAt ? new Date(r.processedAt) : null,
          createdAt: new Date(r.createdAt),
        })),
      };
    });

    if (filters.customerSegment) {
      // Derived segment: lifetime recognised history over the candidate set.
      const events: { key: string; at: Date }[] = [];
      for (const order of candidates) {
        const rev = resolveRevenueEvent({
          timeline: order.timeline ?? [],
          dispatchDeliveredAt: order.dispatchDeliveredAt ?? null,
          currentStatus: order.status,
        });
        if (rev.recognised && rev.revenueDate) {
          events.push({ key: customerKeyOf(order), at: rev.revenueDate });
        }
      }
      const history = deriveCustomerSegments(events);
      candidates = candidates.filter(
        (order) =>
          this.filters.segmentOf(customerKeyOf(order), range, history) ===
          filters.customerSegment,
      );
    }

    const result = computePnl({
      range,
      orders: candidates,
      bookedOrders: booked.map((b: any) => ({
        createdAt: new Date(b.createdAt),
        total: Number(b.total),
      })),
      cashPayments: cash.map((p: any) => ({
        amount: Number(p.amount),
        status: p.status,
        gatewayCode: p.gatewayCode,
        createdAt: new Date(p.createdAt),
      })),
      consumptions: consumptions.map((c: any) => ({
        calculatedCost: Number(c.calculatedCost),
        spendDate: c.spendDate ? new Date(c.spendDate) : null,
        allocatedAt: c.allocatedAt ? new Date(c.allocatedAt) : undefined,
      })),
      expenses: expenses.map((e: any) => ({
        amount: Number(e.amount),
        taxAmount: Number(e.taxAmount),
        expenseDate: new Date(e.expenseDate),
      })),
    });
    return { result, ctx };
  }

  private envelop(result: PnlResult, ctx: ResolvedAnalyticsContext): PnlResponse {
    const empty = result.recognisedOrders === 0;
    const marketing = result.marketingCost.state;
    const money = (
      amount: number,
      state: CostState,
      dateBasis: string,
      reason?: string,
    ) => this.money(amount, state, { dateBasis, empty, reason });
    const ladder = ladderState([
      'actual',
      result.cogs.state,
      result.fulfillmentCost.state,
      result.paymentFees.state,
      marketing,
      'actual',
      OTHER_COSTS_STATE,
    ]);
    return {
      data: {
        lines: {
          grossSales: money(result.grossSales.amount, 'actual', 'Delivered transition'),
          discounts: money(result.discounts.amount, 'actual', 'Delivered transition'),
          returns: result.returnEvents > 0
            ? money(result.returns.amount, 'actual', 'return transition')
            : kpiZero('no return events in range'),
          refundsReversal: result.refundsReversal.amount > 0
            ? money(result.refundsReversal.amount, 'actual', 'processedAt ?? createdAt')
            : kpiZero('no reversal refunds in range'),
          netSales: money(result.netSales.amount, 'actual', 'Delivered transition'),
          cogs: money(result.cogs.amount, result.cogs.state, 'Delivered transition', 'costSnapshot coverage'),
          grossProfit: money(result.grossProfit.amount, ladder === 'actual' ? 'actual' : ladder === 'estimated' ? 'estimated' : 'unavailable', 'Delivered transition'),
          fulfillmentCost: money(result.fulfillmentCost.amount, result.fulfillmentCost.state, 'recognised order cohort'),
          paymentFees: money(result.paymentFees.amount, result.paymentFees.state, 'recognised order cohort'),
          marketingCost: result.marketingCost.state === 'unavailable'
            ? { value: result.marketingCost.amount, state: 'unavailable', reason: `${result.coverage.marketing.undatedRows} consumption(s) missing spendDate (৳${result.coverage.marketing.undatedAmount})`, dateBasis: 'spendDate only' }
            : money(result.marketingCost.amount, 'actual', 'spendDate only'),
          contributionProfit: money(result.contributionProfit.amount, ladder === 'actual' ? 'actual' : ladder === 'estimated' ? 'estimated' : 'unavailable', 'Delivered transition'),
          operatingExpenses: money(result.operatingExpenses.amount, 'actual', 'expenseDate'),
          operatingProfit: money(result.operatingProfit.amount, ladder === 'actual' ? 'actual' : ladder === 'estimated' ? 'estimated' : 'unavailable', 'Delivered transition'),
          otherCosts: kpiNotApplicable('no data source exists'),
          netProfit: empty
            ? kpiNoData('no recognised orders in range')
            : ladder === 'actual'
              ? kpiOk(result.netProfit.amount, { dateBasis: 'Delivered transition' })
              : { value: result.netProfit.amount, state: ladder, reason: ladder === 'estimated' ? 'estimated — see coverage' : `partial — inputs missing`, dateBasis: 'Delivered transition' },
        },
        margins: result.margins,
        bridge: {
          ...result.bridge,
          state: result.bridge.deliveryChargeRetainedState === 'unavailable' || ladder === 'unavailable'
            ? 'unavailable'
            : ladder === 'estimated'
              ? 'estimated'
              : 'ok',
        },
        lenses: {
          booked: kpiOk(result.lenses.booked, { dateBasis: 'Order.createdAt' }),
          recognised: empty
            ? kpiNoData('no recognised orders in range')
            : kpiOk(result.lenses.recognised, { dateBasis: 'Delivered transition' }),
          cashCollected: kpiOk(result.lenses.cashCollected, { dateBasis: 'Payment.createdAt' }),
        },
        strip: result.strip,
        coverage: result.coverage,
        marketing: {
          datedRows: result.coverage.marketing.datedRows,
          undatedRows: result.coverage.marketing.undatedRows,
          datedAmount: result.coverage.marketing.datedAmount,
          undatedAmount: result.coverage.marketing.undatedAmount,
          estimatedReference:
            result.coverage.marketing.undatedRows > 0
              ? {
                  label: 'consumptions missing spendDate — reference only, not a financial period date',
                  excludedFromTotal: true as const,
                }
              : null,
        },
      },
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: result.coverage as unknown as Record<string, unknown>,
        ladderState: ladder,
        thresholds: {
          vipMinLifetimeRecognisedOrders: 5,
          movementFastDoiMax: 30,
          movementSlowDoiMin: 90,
        },
        dateBasis: 'revenue-date (Delivered); refunds processedAt; marketing spendDate; expenses expenseDate',
      }),
    };
  }

  async getPnl(query: AnalyticsFilterDto): Promise<PnlResponse> {
    const key = analyticsCacheKey('pnl', query);
    const cached = await this.cache.get<PnlResponse>(key);
    if (cached) return cached;
    const { result, ctx } = await this.buildReport(query);
    const response = this.envelop(result, ctx);
    await this.cache.set(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  async getLenses(query: AnalyticsFilterDto) {
    const key = analyticsCacheKey('lenses', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const { result, ctx } = await this.buildReport(query);
    const full = this.envelop(result, ctx);
    const response = {
      data: { lenses: full.data.lenses, strip: full.data.strip },
      meta: full.meta,
    };
    await this.cache.set(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  async getExpensesSummary(query: AnalyticsFilterDto) {
    const key = analyticsCacheKey('expenses', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const rows = await this.prisma.expense.findMany({
      where: { expenseDate: { gte: range.start, lte: range.end } },
      select: {
        amount: true,
        taxAmount: true,
        expenseDate: true,
        category: { select: { id: true, name: true, expenseKind: true } },
      },
    });
    const summary = summariseExpenses(
      rows.map((r: any) => ({
        amount: Number(r.amount),
        taxAmount: Number(r.taxAmount),
        expenseDate: new Date(r.expenseDate),
        category: {
          id: r.category.id,
          name: r.category.name,
          expenseKind: r.category.expenseKind,
        },
      })),
      range,
    );
    const response = {
      data: summary,
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: {},
        ladderState: 'actual',
        thresholds: {},
        dateBasis: 'expenseDate',
      }),
    };
    await this.cache.set(key, response, analyticsCacheTtlMs(range));
    return response;
  }
}
