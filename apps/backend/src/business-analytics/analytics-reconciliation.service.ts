/**
 * Business analytics reconciliation service (§4.3).
 *
 * Registry of checks — P8/P9 extend it by pushing entries onto
 * CHECK_REGISTRY (no runner changes). R1/R2 are live (P4 product service);
 * R7/R8 are live (P7 marketing service); R13 stays deferred (needs an
 * accounting period mapping) and returns warn with an explicit reason —
 * never a silent pass.
 */
import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  recognitionGroup,
  resolveRevenueEvent,
  resolveReturn,
  classifyRefund,
  computeNetProfitFromLedger,
  marketingIdentityTotals,
  type TimelineEntry,
} from './metric-contract';
import {
  AnalyticsFilterService,
  type ResolvedAnalyticsContext,
} from './analytics-filter.service';
import type { AnalyticsFilterDto } from './analytics-filter.dto';
import { AnalyticsPnlService } from './analytics-pnl.service';
import { AnalyticsProductsService } from './analytics-products.service';import {
  AnalyticsFulfillmentService,
  assertNoRevenueLeak,
  settleOrder,
} from './analytics-fulfillment.service';
import {
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  type AnalyticsMeta,
} from './analytics-envelope.util';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  expected: unknown;
  actual: unknown;
  explanation: string;
}

export interface ReconciliationWarnings {
  cogsUnavailableUnits: number;
  ordersMissingShippingCost: number;
  paymentsMissingFee: number;
  timelineLessDeliveries: number;
  partialFlagged: number;
  returnPendingInFlight: number;
  unmappedLocations: number;
  /** ExpenseCategory names/slugs matching marketing/ad keywords. */
  marketingOverlapCategories: string[];
  marketingCost: number;
  phoneLessGuests: number;
  shippingRefundInferences: number;
  consumptionsMissingSpendDate: number;
  consumptionsMissingSpendAmount: number;
  codUnsettledOrders: number;
  codUnsettledCourierCost: number;
}

export interface ReconciliationInput {
  ladder: {
    grossSales: number;
    discounts: number;
    returns: number;
    refundsReversal: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    fulfillmentCost: number;
    paymentFees: number;
    marketingCost: number;
    contributionProfit: number;
    operatingExpenses: number;
    operatingProfit: number;
    netProfit: number;
  };
  bridge: {
    contributionProfit: number;
    deliveryChargeRetained: number;
    fulfillmentMargin: number;
    totalBusinessContribution: number;
    operatingProfit: number;
    netProfit: number;
    operands: string[];
  };
  ledgerNetProfit: number;
  expensesTotal: number;
  paidPaymentsTotal: number;
  cashCollected: number;
  partition: {
    total: number;
    recognised: number;
    inFulfilment: number;
    cancelled: number;
    returnedBeforeDelivery: number;
    undatedDeliveries: number;
  };
  settlementOnline: { collected: number; refunded: number; retained: number };
  fulfillmentOnline: {
    margin: number;
    deliveryChargeRetained: number;
    courierCost: number;
  };
  revenueBucketHasSettlement: boolean;
  doubleReversalOrders: string[];
  /** P4 product aggregates: R1 compares productNetSum to the ladder on the
   * pre-refund basis; R2 checks every parent against its variants. */
  products: {
    productNetSum: number;
    /** A product line-scope (product/variant/category/warehouse/search) is
     * active — R1 warns because the identity holds on the unscoped scope. */
    scoped: boolean;
    parents: { productId: string; parentNet: number; variantNetSum: number }[];
  };
  marketingIdentity: { allTimeCost: number; datedCost: number; undatedCost: number };
  marketingPeriodTotal: number;
  /**
   * R7 (P7): independent re-aggregation of the attribution basis —
   * Σ MarketingCostAllocation.allocatedCost by calculatedAt in range over
   * non-trashed orders. Compared against the ladder marketingCost (P&L
   * spend-date basis); divergence is expected by design (§8.13), so a delta
   * warns with cause, never fails.
   */
  marketingAllocationTotal: number;
  /**
   * R8 (P7): date-independent per-campaign identity —
   * Σ ProductMarketingCost.marketingCost vs Σ MarketingConsumption
   * .calculatedCost, all-time. Rounding dust is bounded per row (each
   * Math.round to 2dp contributes ≤ half a cent), so the per-campaign
   * tolerance is 0.005 × (allocRows + pmcRows) + 0.005 slack.
   */
  marketingCampaignIdentity: {
    campaigns: {
      campaignId: string;
      name: string;
      consumptionCost: number;
      productCost: number;
      allocRows: number;
      pmcRows: number;
    }[];
    nullCampaignConsumption: number;
  };
  codLeakOrders: string[];
  warnings: ReconciliationWarnings;
}

export interface CheckDef {
  id: string;
  title: string;
  run: (input: ReconciliationInput) => CheckResult;
}

const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

function result(
  id: string,
  status: CheckStatus,
  expected: unknown,
  actual: unknown,
  explanation: string,
): CheckResult {
  return { id, status, expected, actual, explanation };
}

/** R-checks with live implementations (R7/R8 live since P7; R13 deferred). */
export const CHECK_REGISTRY: CheckDef[] = [
  {
    id: 'R1',
    title: 'Σ product Net Sales == Business Net Sales (pre-refund basis)',
    run: (i) => {
      if (i.products.scoped) {
        return result(
          'R1',
          'warn',
          'unscoped identity',
          'scoped',
          'a product line-scope (product/variant/category/warehouse/search) is active — the R1 identity holds on the unscoped scope only',
        );
      }
      // Refunds are order-level and are never allocated to products
      // (limitation 3), so the product universe nets to gross − discounts −
      // returns: the ladder net plus the refund reversal back.
      const expected = i.ladder.netSales + i.ladder.refundsReversal;
      const ok = eq(i.products.productNetSum, expected);
      return result(
        'R1',
        ok ? 'pass' : 'fail',
        expected,
        i.products.productNetSum,
        ok
          ? 'product Net Sales sum to the ladder net on the pre-refund basis (refunds unallocated by design)'
          : 'product/ladder drift: Σ product Net Sales differs from net + refundsReversal — recognition or discount logic diverged between the product and ladder paths',
      );
    },
  },
  {
    id: 'R2',
    title: 'Σ variant Net Sales == parent product Net Sales',
    run: (i) => {
      const bad = i.products.parents
        .filter((p) => !eq(p.parentNet, p.variantNetSum))
        .map((p) => p.productId);
      return result(
        'R2',
        bad.length === 0 ? 'pass' : 'fail',
        [],
        bad,
        bad.length === 0
          ? 'every parent foots to its variants (parent = Σ children, derived never stored)'
          : `parents not footing to variants: ${bad.join(', ')}`,
      );
    },
  },
  {
    id: 'R3',
    title: 'Ladder components rebuild to the reported Net Profit',
    run: (i) => {
      const l = i.ladder;
      const net = l.grossSales - l.discounts - l.returns - l.refundsReversal;
      const gp = net - l.cogs;
      const cp = gp - l.fulfillmentCost - l.paymentFees - l.marketingCost;
      // §2.11: delivery income joins through the bridge — Operating Profit
      // and Net Profit are TBC − OE, i.e. CP + DCR − OE. A DCR-blind
      // recompute (cp − opex) drifts the moment any online order retains a
      // delivery charge.
      const tbc = cp + i.bridge.deliveryChargeRetained;
      const op = tbc - l.operatingExpenses;
      const ok =
        eq(net, l.netSales) &&
        eq(gp, l.grossProfit) &&
        eq(cp, l.contributionProfit) &&
        eq(tbc, i.bridge.totalBusinessContribution) &&
        eq(op, l.operatingProfit) &&
        eq(op, l.netProfit);
      return result(
        'R3',
        ok ? 'pass' : 'fail',
        l.netProfit,
        op,
        ok
          ? 'ladder foots independently to Net Profit'
          : 'ladder drift: recomputed Net Profit differs — metric-contract formulas changed without updating the service',
      );
    },
  },
  {
    id: 'R4',
    title: 'Expense analytics total == Σ Expense.amount + taxAmount',
    run: (i) =>
      result(
        'R4',
        eq(i.expensesTotal, i.ladder.operatingExpenses) ? 'pass' : 'fail',
        i.ladder.operatingExpenses,
        i.expensesTotal,
        'operating expenses must tie to the Expense table sum by expenseDate',
      ),
  },
  {
    id: 'R5',
    title: 'Σ PAID Payment.amount == Cash collected (L3)',
    run: (i) =>
      result(
        'R5',
        eq(i.paidPaymentsTotal, i.cashCollected) ? 'pass' : 'fail',
        i.cashCollected,
        i.paidPaymentsTotal,
        'L3 cash is the PAID payment sum by createdAt — independent re-aggregation must agree',
      ),
  },
  {
    id: 'R6',
    title: 'Delivery crossover: booked partitions with zero remainder',
    run: (i) => {
      const p = i.partition;
      const parts =
        p.recognised + p.inFulfilment + p.cancelled + p.returnedBeforeDelivery + p.undatedDeliveries;
      return result(
        'R6',
        p.total === parts ? 'pass' : 'fail',
        p.total,
        parts,
        'booked == recognised + in-fulfilment + cancelled + returned-before-delivery + undatedDeliveries',
      );
    },
  },
  {
    id: 'R7',
    title: 'Marketing date-basis divergence: P&L (spend-date) vs attribution allocations, delta with cause',
    run: (i) => {
      const pnl = i.ladder.marketingCost;
      const alloc = i.marketingAllocationTotal;
      const delta = pnl - alloc;
      if (eq(pnl, alloc)) {
        return result(
          'R7',
          'pass',
          pnl,
          alloc,
          'spend-date P&L and attribution allocations agree this period (agreement is coincidental — the bases differ by design)',
        );
      }
      return result(
        'R7',
        'warn',
        pnl,
        alloc,
        `Δ ৳${delta.toFixed(2)} (P&L ৳${pnl.toFixed(2)} vs allocations ৳${alloc.toFixed(2)}): ` +
          'P&L is Σ consumptions by spendDate while allocations are Σ MarketingCostAllocation by calculatedAt — ' +
          'different bases by design (§8.13). Undated consumptions sit in P&L coverage but never in the period total, ' +
          'and spend without same-day attributed orders never allocates.',
      );
    },
  },
  {
    id: 'R8',
    title: 'Marketing identity (date-independent): Σ ProductMarketingCost == Σ consumptions by campaign, all-time',
    run: (i) => {
      const identity = i.marketingCampaignIdentity;
      const bad = identity.campaigns
        .filter(
          (c) =>
            Math.abs(c.consumptionCost - c.productCost) >
            0.005 * (c.allocRows + c.pmcRows) + 0.005,
        )
        .map(
          (c) =>
            `${c.name} (${c.campaignId}): consumption ৳${c.consumptionCost.toFixed(2)} vs attributed ৳${c.productCost.toFixed(2)}`,
        );
      const nullLeak = identity.nullCampaignConsumption > 0.005;
      if (nullLeak) {
        bad.push(
          `consumptions with no campaign: ৳${identity.nullCampaignConsumption.toFixed(2)} (no campaign identity to match)`,
        );
      }
      return result(
        'R8',
        bad.length === 0 ? 'pass' : 'fail',
        identity.campaigns.map((c) => c.consumptionCost),
        identity.campaigns.map((c) => c.productCost),
        bad.length === 0
          ? 'every campaign foots all-time: attributed product cost ties to FIFO consumption cost within rounding dust'
          : `campaigns not footing to consumptions: ${bad.join('; ')}`,
      );
    },
  },
  {
    id: 'R9',
    title: 'Settlement identity (online only): collected − refunded == retained',
    run: (i) => {
      const s = i.settlementOnline;
      return result(
        'R9',
        eq(s.collected - s.refunded, s.retained) ? 'pass' : 'fail',
        s.retained,
        s.collected - s.refunded,
        'online settlement identity over PAID payments and completed refunds',
      );
    },
  },
  {
    id: 'R10',
    title: 'Fulfillment identity (online only): margin == DCR − courierCost',
    run: (i) => {
      const f = i.fulfillmentOnline;
      return result(
        'R10',
        eq(f.margin, f.deliveryChargeRetained - f.courierCost) ? 'pass' : 'fail',
        f.margin,
        f.deliveryChargeRetained - f.courierCost,
        'online fulfillment identity',
      );
    },
  },
  {
    id: 'R11',
    title: 'Leak guard: settlement amounts in zero revenue buckets',
    run: (i) =>
      result(
        'R11',
        i.revenueBucketHasSettlement ? 'fail' : 'pass',
        0,
        i.revenueBucketHasSettlement ? 1 : 0,
        'settlement money must never appear in Gross/Net Sales or any profit line',
      ),
  },
  {
    id: 'R12',
    title: 'Double-reversal guard: no order in both Returns and Refunds (reversal)',
    run: (i) =>
      result(
        'R12',
        i.doubleReversalOrders.length === 0 ? 'pass' : 'fail',
        [],
        i.doubleReversalOrders,
        'an order contributes to Returns xor Refunds-reversal, never both',
      ),
  },
  {
    id: 'R14',
    title: 'Bridge identity: TBC == Contribution Profit + Delivery Charge Retained',
    run: (i) =>
      result(
        'R14',
        eq(
          i.bridge.totalBusinessContribution,
          i.bridge.contributionProfit + i.bridge.deliveryChargeRetained,
        )
          ? 'pass'
          : 'fail',
        i.bridge.totalBusinessContribution,
        i.bridge.contributionProfit + i.bridge.deliveryChargeRetained,
        'single-count bridge (D12)',
      ),
  },
  {
    id: 'R15',
    title: 'Forbidden-formula guard: FM is never a bridge operand',
    run: (i) => {
      const ok =
        i.bridge.operands.length === 2 &&
        i.bridge.operands.includes('contributionProfit') &&
        i.bridge.operands.includes('deliveryChargeRetained') &&
        !i.bridge.operands.includes('fulfillmentMargin');
      return result(
        'R15',
        ok ? 'pass' : 'fail',
        ['contributionProfit', 'deliveryChargeRetained'],
        i.bridge.operands,
        'CP + Fulfillment Margin would subtract courierCost twice — structurally impossible: operands are fixed',
      );
    },
  },
  {
    id: 'R16',
    title: 'Component-once ledger sums to Net Profit',
    run: (i) =>
      result(
        'R16',
        eq(i.ledgerNetProfit, i.bridge.netProfit) ? 'pass' : 'fail',
        i.bridge.netProfit,
        i.ledgerNetProfit,
        'every §2.11 component appears exactly once and the ledger foots to Net Profit',
      ),
  },
  {
    id: 'R17',
    title: 'Marketing strictness: dated + undated identity; undated contributes 0',
    run: (i) => {
      const m = i.marketingIdentity;
      const identity = eq(m.allTimeCost, m.datedCost + m.undatedCost);
      const excluded = i.marketingPeriodTotal <= m.datedCost + 0.005;
      const ok = identity && excluded;
      return result(
        'R17',
        ok ? 'pass' : 'fail',
        m.allTimeCost,
        m.datedCost + m.undatedCost,
        'Σ all == Σ dated + Σ undated and no period total contains undated cost (allocatedAt never a date)',
      );
    },
  },
  {
    id: 'R18',
    title: 'COD honesty: no COD order carries collection figures',
    run: (i) =>
      result(
        'R18',
        i.codLeakOrders.length === 0 ? 'pass' : 'fail',
        [],
        i.codLeakOrders,
        'COD collected/retained/DCR/margin stay unavailable until a settlement source exists (D11)',
      ),
  },
];

/**
 * Deferred checks (warn with reasons, never silent). R13 note: accounting
 * exposes profitAndLoss(periodId) keyed by financial period, while analytics
 * ranges are Dhaka date windows with no period mapping — plus the F1 delta is
 * expected by construction (orders never post journals). P10 maps the delta
 * once a range→period correspondence exists. (R7/R8 went live in P7.)
 */
export const DEFERRED_CHECKS: Record<string, string> = {
  R13: 'deferred: accounting.profitAndLoss is keyed by financial periodId with no range mapping; the F1 delta (orders never post journals) is expected by construction and reported with cause',
};

const WARNING_DEFS: {
  id: string;
  pick: (w: ReconciliationWarnings) => { count: number; detail: string };
}[] = [
  { id: 'W1', pick: (w) => ({ count: w.cogsUnavailableUnits, detail: `${w.cogsUnavailableUnits} unit(s) without costSnapshot` }) },
  { id: 'W2', pick: (w) => ({ count: w.ordersMissingShippingCost, detail: `${w.ordersMissingShippingCost} recognised order(s) missing shippingCost` }) },
  { id: 'W3', pick: (w) => ({ count: w.paymentsMissingFee, detail: `${w.paymentsMissingFee} PAID payment(s) missing feeAmount` }) },
  { id: 'W4', pick: (w) => ({ count: w.timelineLessDeliveries, detail: `${w.timelineLessDeliveries} deliverie(s) dated via Dispatch fallback or undated` }) },
  { id: 'W5', pick: (w) => ({ count: w.partialFlagged, detail: `${w.partialFlagged} Partial order(s): unrecognised, flagged, no partial value invented` }) },
  { id: 'W6', pick: (w) => ({ count: w.returnPendingInFlight, detail: `${w.returnPendingInFlight} Return Pending order(s) in flight` }) },
  { id: 'W7', pick: (w) => ({ count: w.unmappedLocations, detail: `${w.unmappedLocations} order(s) with no city/state/zip snapshot` }) },
  {
    id: 'W8',
    pick: (w) =>
      w.marketingOverlapCategories.length > 0 && w.marketingCost > 0
        ? { count: w.marketingOverlapCategories.length, detail: `possible ad-spend double entry: ${w.marketingOverlapCategories.join(', ')}` }
        : { count: 0, detail: 'no ad-keyword category overlap' },
  },
  { id: 'W9', pick: (w) => ({ count: w.phoneLessGuests, detail: `${w.phoneLessGuests} phone-less guest order(s) unattributable` }) },
  {
    id: 'W10',
    pick: (w) =>
      w.consumptionsMissingSpendDate > 0
        ? { count: w.consumptionsMissingSpendDate, detail: `${w.consumptionsMissingSpendDate} consumption(s) missing spendDate (৳${w.consumptionsMissingSpendAmount})` }
        : { count: 0, detail: 'all consumption rows dated' },
  },
  {
    id: 'W11',
    pick: (w) =>
      w.codUnsettledOrders > 0
        ? { count: w.codUnsettledOrders, detail: `${w.codUnsettledOrders} COD order(s) with unavailable settlement (৳${w.codUnsettledCourierCost} courier cost)` }
        : { count: 0, detail: 'no unsettled COD orders' },
  },
];

export function evaluateChecks(input: ReconciliationInput): CheckResult[] {
  const out: CheckResult[] = CHECK_REGISTRY.map((c) => c.run(input));
  for (const [id, reason] of Object.entries(DEFERRED_CHECKS)) {
    out.push({ id, status: 'warn', expected: 'implemented', actual: 'deferred', explanation: reason });
  }
  // W8 also needs the quiet case: overlap with zero marketing cost is pass.
  for (const def of WARNING_DEFS) {
    const { count, detail } = def.pick(input.warnings);
    out.push({
      id: def.id,
      status: count > 0 ? 'warn' : 'pass',
      expected: 0,
      actual: count,
      explanation: detail,
    });
  }
  return out;
}

/** Ad-spend overlap keywords (F6 user-configuration risk → W8). Word-bounded
 * on both sides so 'leads' never matches the ads alternative. */
export const MARKETING_OVERLAP_RE =
  /\b(marketing|market|advert|ads?|promo|facebook|google|meta|tiktok|boost)\b/i;

/**
 * Candidate-order projection for the partition / double-reversal / COD-leak
 * re-derivation. Typed via the Prisma select payload — no `any` rows.
 */
const reconciliationCandidateSelect = {
  id: true,
  status: { select: { name: true } },
  timeline: true,
  paymentOptionType: true,
  customerId: true,
  customerPhone: true,
  guestPhone: true,
  customerCity: true,
  customerState: true,
  customerZip: true,
  shippingCost: true,
  shippingCharge: true,
  shippingCostSource: true,
  payments: {
    select: { amount: true, status: true, gatewayCode: true, createdAt: true },
  },
  refunds: {
    select: {
      id: true,
      amount: true,
      status: true,
      processedAt: true,
      createdAt: true,
    },
  },
  dispatches: { select: { deliveredAt: true } },
} satisfies Prisma.OrderSelect;

export type ReconciliationCandidate = Prisma.OrderGetPayload<{
  select: typeof reconciliationCandidateSelect;
}>;

@Injectable()
export class AnalyticsReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly pnl: AnalyticsPnlService,
    private readonly fulfillment: AnalyticsFulfillmentService,
    private readonly products: AnalyticsProductsService,
    private readonly cache: CacheService,
  ) {}

  async runReconciliation(query: AnalyticsFilterDto): Promise<{
    data: { checks: CheckResult[]; summary: { pass: number; warn: number; fail: number } };
    meta: AnalyticsMeta;
  }> {
    const key = analyticsCacheKey('reconciliation', query);
    const cached = await this.cache.get<{
      data: { checks: CheckResult[]; summary: { pass: number; warn: number; fail: number } };
      meta: AnalyticsMeta;
    }>(key);
    if (cached) return cached;

    const ctx: ResolvedAnalyticsContext = this.filters.resolveContext(query);
    const { range, filters } = ctx;
    const marketingOrderIds = filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    // Strip the payments relation filter: valid on Order, but the R5
    // aggregate below filters Payment rows with `order` as the relation
    // filter, where a payments sub-filter would be invalid.
    const { payments: _strippedPaymentsFilter, ...orderPart } = where;
    void _strippedPaymentsFilter;

    // Four overlapping reads, deliberately separate (not one shared fetch):
    // pnl.getPnl, fulfillment.getFulfillment and products.getAggregates each
    // own their projections and date bases (recognition-dated revenue vs
    // the candidates/expenses/consumptions/categories/aggregate reads below
    // re-derive the partition, R12, R18, R4, R5 and R17 checks INDEPENDENTLY
    // of the ladder/settlement code paths — sharing row objects would couple
    // the checker to the checked and let a regression pass itself. The
    // dedicated R5 aggregate is its own query by the same principle (never
    // the lens value fed back to itself).
    const [pnlRes, fulRes, productsAgg, candidates, expenseRows, consumptions, categories, paidAgg, allocationTotalAgg, consumptionByCampaign, allocRowsByCampaign, pmcByAllocation, allocIdToCampaign, campaignNames] =
      await Promise.all([
        this.pnl.getPnl(query),
        this.fulfillment.getFulfillment(query),
        this.products.getAggregates(query),
        this.prisma.order.findMany({
          where,
          select: reconciliationCandidateSelect,
        }),
        this.prisma.expense.findMany({
          where: { expenseDate: { gte: range.start, lte: range.end } },
          select: { amount: true, taxAmount: true },
        }),
        this.prisma.marketingConsumption.findMany({
          select: { calculatedCost: true, spendDate: true },
        }),
        this.prisma.expenseCategory.findMany({
          select: { name: true, slug: true },
        }),
        // R5: independent re-aggregation of L3 cash (Σ PAID by createdAt),
        // issued as its own query — never the lens value fed back to itself.
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: {
            status: PaymentStatus.PAID,
            createdAt: { gte: range.start, lte: range.end },
            ...(filters.paymentMethod ? { gatewayCode: filters.paymentMethod } : {}),
            order: orderPart,
          },
        }),
        // R7: independent re-aggregation of the attribution basis
        // (Σ allocatedCost by calculatedAt, non-trashed orders) — never the
        // ladder value fed back to itself.
        this.prisma.marketingCostAllocation.aggregate({
          _sum: { allocatedCost: true },
          where: {
            calculatedAt: { gte: range.start, lte: range.end },
            order: { trashedAt: null },
          },
        }),
        // R8: date-independent per-campaign identity, all-time. Consumptions
        // group by campaign (NULL campaignId groups separately — it has no
        // campaign identity to match); product costs roll up via their
        // allocation's campaign.
        this.prisma.marketingConsumption.groupBy({
          by: ['campaignId'],
          _sum: { calculatedCost: true },
        }),
        this.prisma.marketingCostAllocation.groupBy({
          by: ['campaignId'],
          _count: { _all: true },
        }),
        this.prisma.productMarketingCost.groupBy({
          by: ['allocationId'],
          _sum: { marketingCost: true },
          _count: { _all: true },
        }),
        this.prisma.marketingCostAllocation.findMany({
          select: { id: true, campaignId: true },
        }),
        this.prisma.marketingCampaign.findMany({
          select: { id: true, name: true },
        }),
      ]);

    const num = (v: number | null | undefined) => v ?? 0;
    const L = pnlRes.data.lines;
    const ladder = {
      grossSales: num(L.grossSales.value),
      discounts: num(L.discounts.value),
      returns: num(L.returns.value),
      refundsReversal: num(L.refundsReversal.value),
      netSales: num(L.netSales.value),
      cogs: num(L.cogs.value),
      grossProfit: num(L.grossProfit.value),
      fulfillmentCost: num(L.fulfillmentCost.value),
      paymentFees: num(L.paymentFees.value),
      marketingCost: num(L.marketingCost.value),
      contributionProfit: num(L.contributionProfit.value),
      operatingExpenses: num(L.operatingExpenses.value),
      operatingProfit: num(L.operatingProfit.value),
      netProfit: num(L.netProfit.value),
    };
    const bridge = pnlRes.data.bridge;
    const coverage = pnlRes.data.coverage;

    // Partition (R6) + double-reversal re-scan (R12) + COD scan (R18).
    // R12/R18 re-derive from raw rows through metric-contract predicates +
    // settleOrder — independent of the ladder code path, so a regression in
    // either implementation fails the check.
    const partition = {
      total: candidates.length,
      recognised: 0,
      inFulfilment: 0,
      cancelled: 0,
      returnedBeforeDelivery: 0,
      undatedDeliveries: 0,
    };
    const doubleReversalOrders: string[] = [];
    const codLeakOrders: string[] = [];
    let partialFlagged = 0;
    let returnPendingInFlight = 0;
    let unmappedLocations = 0;
    let phoneLessGuests = 0;
    const inRange = (at: Date | null) =>
      at !== null && at >= range.start && at <= range.end;
    const toDate = (v: unknown): Date | null => {
      if (v === null || v === undefined) return null;
      const d = v instanceof Date ? v : new Date(v as string);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    for (const o of candidates) {
      const statusName: string = o.status?.name ?? '';
      let group: string | null = null;
      try {
        group = recognitionGroup(statusName);
      } catch {
        group = null;
      }
      // Timeline is our own JSONB write-shape; guard the array, then narrow.
      const timeline: TimelineEntry[] = Array.isArray(o.timeline)
        ? (o.timeline as unknown as TimelineEntry[])
        : [];
      const deliveredAts = o.dispatches
        .map((d) => toDate(d.deliveredAt))
        .filter((d): d is Date => d !== null);
      const rev = resolveRevenueEvent({
        timeline,
        dispatchDeliveredAt:
          deliveredAts.length > 0
            ? new Date(Math.max(...deliveredAts.map((d) => d.getTime())))
            : null,
        currentStatus: statusName,
      });
      const ret = resolveReturn(timeline, rev.revenueDate);
      if (group === 'never') partition.cancelled += 1;
      else if (rev.recognised) partition.recognised += 1;
      else if (rev.undatedDelivery) partition.undatedDeliveries += 1;
      else if (ret.hasReturn) partition.returnedBeforeDelivery += 1;
      else partition.inFulfilment += 1;

      const inReturns =
        rev.recognised && ret.reversesRevenue && inRange(ret.returnAt);
      const wasReturned = ret.reversesRevenue && ret.returnAt !== null;
      const hasReversalRefund = o.refunds.some((r) => {
        if (r.status !== 'completed') return false;
        if (classifyRefund({ wasDelivered: rev.recognised, wasReturned }) !== 'reversal') {
          return false;
        }
        return inRange(toDate(r.processedAt) ?? toDate(r.createdAt));
      });
      if (inReturns && hasReversalRefund) doubleReversalOrders.push(o.id);

      const settled = settleOrder({
        id: o.id,
        paymentOptionType: o.paymentOptionType,
        shippingCharge: Number(o.shippingCharge),
        shippingCost: o.shippingCost === null ? null : Number(o.shippingCost),
        shippingCostSource:
          o.shippingCostSource === 'manual' ||
          o.shippingCostSource === 'courier_default'
            ? o.shippingCostSource
            : null,
        payments: o.payments.map((p) => ({
          amount: Number(p.amount),
          status: p.status,
          gatewayCode: p.gatewayCode,
          createdAt: toDate(p.createdAt) ?? new Date(0),
        })),
        refunds: o.refunds.map((r) => ({
          amount: Number(r.amount),
          status: r.status,
          createdAt: toDate(r.createdAt) ?? new Date(0),
        })),
      });
      if (
        settled.collection !== 'online' &&
        (settled.amountCollected.value !== null ||
          settled.amountRetained.value !== null ||
          settled.deliveryChargeRetained.value !== null ||
          settled.fulfillmentMargin.value !== null)
      ) {
        codLeakOrders.push(o.id);
      }

      if (statusName === 'Partial') partialFlagged += 1;
      if (statusName === 'Return Pending') returnPendingInFlight += 1;
      if (!o.customerCity && !o.customerState && !o.customerZip) {
        unmappedLocations += 1;
      }
      if (!o.customerId && !o.customerPhone && !o.guestPhone) {
        phoneLessGuests += 1;
      }
    }

    const ledgerNetProfit = computeNetProfitFromLedger({
      grossSales: ladder.grossSales,
      discounts: ladder.discounts,
      returns: ladder.returns,
      refundsReversal: ladder.refundsReversal,
      deliveryChargeRetained: bridge.deliveryChargeRetained,
      cogs: ladder.cogs,
      courierCost: ladder.fulfillmentCost,
      paymentFees: ladder.paymentFees,
      marketingCost: ladder.marketingCost,
      operatingExpenses: ladder.operatingExpenses,
    });

    const expensesTotal = expenseRows.reduce(
      (s, e) => s + Number(e.amount) + Number(e.taxAmount),
      0,
    );
    const identity = marketingIdentityTotals(
      consumptions.map((c) => ({
        calculatedCost: Number(c.calculatedCost),
        spendDate: c.spendDate ? new Date(c.spendDate) : null,
      })),
    );
    const overlap = categories
      .filter(
        (c) =>
          MARKETING_OVERLAP_RE.test(c.name ?? '') ||
          MARKETING_OVERLAP_RE.test(c.slug ?? ''),
      )
      .map((c) => c.name);

    // R8 join (all JS, over the independent reads above): campaignId →
    // { consumptionCost, productCost, allocRows, pmcRows }.
    const nameByCampaign = new Map(
      (campaignNames as { id: string; name: string }[]).map((c) => [c.id, c.name]),
    );
    const allocCampaignById = new Map(
      (allocIdToCampaign as { id: string; campaignId: string }[]).map((a) => [
        a.id,
        a.campaignId,
      ]),
    );
    const r8ByCampaign = new Map<
      string,
      {
        campaignId: string;
        name: string;
        consumptionCost: number;
        productCost: number;
        allocRows: number;
        pmcRows: number;
      }
    >();
    const r8entry = (campaignId: string) => {
      let entry = r8ByCampaign.get(campaignId);
      if (!entry) {
        entry = {
          campaignId,
          name: nameByCampaign.get(campaignId) ?? campaignId,
          consumptionCost: 0,
          productCost: 0,
          allocRows: 0,
          pmcRows: 0,
        };
        r8ByCampaign.set(campaignId, entry);
      }
      return entry;
    };
    let nullCampaignConsumption = 0;
    for (const row of consumptionByCampaign as {
      campaignId: string | null;
      _sum: { calculatedCost: unknown };
    }[]) {
      const amount = Number(row._sum.calculatedCost ?? 0);
      if (row.campaignId === null) nullCampaignConsumption += amount;
      else r8entry(row.campaignId).consumptionCost += amount;
    }
    for (const row of allocRowsByCampaign as {
      campaignId: string;
      _count: { _all: number };
    }[]) {
      r8entry(row.campaignId).allocRows += row._count._all;
    }
    for (const row of pmcByAllocation as {
      allocationId: string;
      _sum: { marketingCost: unknown };
      _count: { _all: number };
    }[]) {
      const campaignId = allocCampaignById.get(row.allocationId);
      if (!campaignId) continue;
      const entry = r8entry(campaignId);
      entry.productCost += Number(row._sum.marketingCost ?? 0);
      entry.pmcRows += row._count._all;
    }

    const ful = fulRes.data;
    const onlineRows = ful.rows.filter((r) => r.collection === 'online');

    // R11 is measured live, never hardcoded: the range fulfillment payload
    // must carry zero revenue-bucket keys (structural guard from the
    // fulfillment path, enforced here over the computed rows). A leak fails
    // the check with the guard's message — never a silent pass.
    let revenueBucketHasSettlement = false;
    try {
      assertNoRevenueLeak(
        ful.rows as unknown as Record<string, unknown>[],
      );
    } catch {
      revenueBucketHasSettlement = true;
    }

    const checks = evaluateChecks({
      ladder,
      bridge: {
        contributionProfit: bridge.contributionProfit,
        deliveryChargeRetained: bridge.deliveryChargeRetained,
        fulfillmentMargin: bridge.fulfillmentMargin,
        totalBusinessContribution: bridge.totalBusinessContribution,
        operatingProfit: bridge.operatingProfit,
        netProfit: bridge.netProfit,
        operands: [...bridge.operands],
      },
      ledgerNetProfit,
      expensesTotal,
      paidPaymentsTotal: Number(paidAgg._sum.amount ?? 0),
      cashCollected: pnlRes.data.lenses.cashCollected.value ?? 0,
      partition,
      settlementOnline: {
        collected: ful.totals.collected,
        refunded: onlineRows.reduce((s, r) => s + (r.amountRefunded.value ?? 0), 0),
        retained: onlineRows.reduce((s, r) => s + (r.amountRetained.value ?? 0), 0),
      },
      fulfillmentOnline: {
        margin: ful.totals.fulfillmentMargin,
        deliveryChargeRetained: ful.totals.deliveryChargeRetained,
        courierCost: onlineRows.reduce((s, r) => s + (r.courierCost.value ?? 0), 0),
      },
      revenueBucketHasSettlement,
      doubleReversalOrders,
      products: {
        productNetSum: productsAgg.productNetSum,
        scoped: productsAgg.scoped,
        parents: productsAgg.parents,
      },
      marketingIdentity: identity,
      marketingPeriodTotal: ladder.marketingCost,
      marketingAllocationTotal: Number(allocationTotalAgg._sum.allocatedCost ?? 0),
      marketingCampaignIdentity: {
        campaigns: [...r8ByCampaign.values()],
        nullCampaignConsumption,
      },
      codLeakOrders,
      warnings: {
        cogsUnavailableUnits: coverage.cogs.unavailableUnits,
        ordersMissingShippingCost: coverage.shipping.unavailableOrders,
        paymentsMissingFee: coverage.fees.withoutFee,
        timelineLessDeliveries: pnlRes.data.strip.undatedDeliveries,
        partialFlagged,
        returnPendingInFlight,
        unmappedLocations,
        marketingOverlapCategories: overlap,
        marketingCost: ladder.marketingCost,
        phoneLessGuests,
        shippingRefundInferences: bridge.shippingRefundInferences,
        consumptionsMissingSpendDate: coverage.marketing.undatedRows,
        consumptionsMissingSpendAmount: coverage.marketing.undatedAmount,
        codUnsettledOrders: ful.coverage.collectionUnavailableOrders,
        codUnsettledCourierCost: ful.coverage.unknownAmount,
      },
    });

    const summary = {
      pass: checks.filter((c) => c.status === 'pass').length,
      warn: checks.filter((c) => c.status === 'warn').length,
      fail: checks.filter((c) => c.status === 'fail').length,
    };
    const response = {
      data: { checks, summary },
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: pnlRes.meta.costCoverage,
        ladderState: pnlRes.meta.ladderState,
        thresholds: pnlRes.meta.thresholds,
        dateBasis: 'reconciliation over the pnl + fulfillment scope',
      }),
    };
    await this.cacheSet(key, response, analyticsCacheTtlMs(range));
    return response;
  }

  /**
   * Read-path cache write: a cache blip serves the computed response anyway
   * (the next read simply recomputes) — it must never fail the request.
   */
  private async cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMs);
    } catch {
      /* computed response is served regardless */
    }
  }
}
