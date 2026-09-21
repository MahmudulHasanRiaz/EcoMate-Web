/**
 * Business analytics marketing service (P7, §2.4 + §4.3 R7/R8 + §8.13/8.14).
 *
 * P&L Marketing Cost is Σ MarketingConsumption.calculatedCost dated by
 * spendDate ONLY (P1 marketingPeriodCost — reused, never reimplemented).
 * spendDate NULL ⇒ excluded from EVERY period total, quantified
 * (undatedRows/undatedAmount), line state unavailable. allocatedAt and
 * calculatedAt are NEVER financial dates: the storage shape carries them,
 * but the financial mapping drops them structurally (see
 * toFinancialConsumptionRows) and they surface only as a labelled
 * estimatedReference, excluded from every total.
 *
 * Attribution views sit on THEIR OWN bases, each stated explicitly:
 * source/channel/segment revenue over delivery-recognised orders (the P&L
 * cohort); the campaign→ad set→ad tree over recorded insight rows (insight
 * date) + OrderAttribution intake (Order.createdAt) + consumptions
 * (spendDate) — adapted from MarketingCampaignInsight/AdSet/Ad and the
 * marketing-analysis basis, never recomputed from the provider. A
 * period-by-period mismatch vs P&L cost is EXPECTED (§8.13); agreement is
 * verified date-independently by R8.
 *
 * Read-only over the marketing module: Prisma reads alone, no marketing
 * service calls, no writes, no behaviour changes there.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  resolveRevenueEvent,
  allocateDiscount,
  marketingPeriodCost,
  type TimelineEntry,
  type MarketingConsumptionRow,
  type MarketingPeriodCost,
} from './metric-contract';
import {
  AnalyticsFilterService,
  VIP_MIN_LIFETIME_RECOGNISED_ORDERS,
  customerKeyOf,
  deriveCustomerSegments,
  resolveMarketingSource,
} from './analytics-filter.service';
import { MARKETING_UNATTRIBUTED } from './analytics-filter.dto';
import type { MarketingQueryDto } from './analytics-marketing.dto';
import { marketingPagination } from './analytics-marketing.dto';
import type { AnalyticsFilterDto } from './analytics-filter.dto';
import type { ResolvedAnalyticsContext } from './analytics-filter.service';
import {
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  kpiOk,
  kpiZero,
  kpiNoData,
  type KpiValue,
  type AnalyticsMeta,
} from './analytics-envelope.util';

// ---------------------------------------------------------------------------
// Verbatim disclosure strings (mirrored by the admin marketing page).
// ---------------------------------------------------------------------------

/** §2.4 spend-date basis — stated on the cost panel and every cost KPI. */
export const SPEND_DATE_BASIS_STATEMENT =
  'P&L Marketing Cost counts Σ MarketingConsumption.calculatedCost dated by spendDate only. Rows with no spendDate are excluded from every period total.';

/** D10 — allocatedAt/calculatedAt are never financial dates. */
export const ALLOCATED_AT_NOTE =
  'allocatedAt and calculatedAt are never financial dates — shown as reference only, excluded from every total.';

/** §8.13 — attribution/P&L period mismatch is expected, never a defect. */
export const ATTRIBUTION_MISMATCH_STATEMENT =
  'Attribution views sit on their own date basis (insight date and attribution date), not the P&L spend-date basis. ' +
  'A period-by-period mismatch against P&L Marketing Cost is expected by design; ' +
  'agreement is verified date-independently (R8).';

/** §2.4 — spend on orders that never recognised revenue is insight-only. */
export const UNRECOGNISED_SPEND_NOTE =
  'Spend allocated to orders that never recognised revenue (cancelled or undelivered). ' +
  'An insight only — never folded into the P&L ladder.';

/** §4.2 — undated-spend fix-list actions (sync/replay in the marketing module). */
export const UNDATED_FIX_ACTIONS: { label: string; href: string }[] = [
  { label: 'Resync spend', href: '/op/marketing/spend-snapshots' },
  { label: 'Replay allocations', href: '/op/marketing/attribution' },
];

/** Undated fix-list row caption for the allocatedAt reference column. */
export const UNDATED_ALLOCATED_AT_CAPTION =
  'allocatedAt reference only — not a financial period date';

// ---------------------------------------------------------------------------
// Pure inputs.
// ---------------------------------------------------------------------------

/**
 * Storage-shaped consumption row. allocatedAt/calculatedAt are accepted here
 * ONLY so the mapping can prove they are dropped: the financial type
 * (MarketingConsumptionRow) has no such field.
 */
export interface DatedConsumptionInput {
  calculatedCost: number;
  spendDate: Date | string | null;
  allocatedAt?: Date | string | null;
  calculatedAt?: Date | string | null;
}

/** Structural drop: allocatedAt/calculatedAt cannot enter the financial sum. */
export function toFinancialConsumptionRows(
  rows: DatedConsumptionInput[],
): MarketingConsumptionRow[] {
  return rows.map((r) => ({
    calculatedCost: r.calculatedCost,
    spendDate: r.spendDate,
  }));
}

/** Spend-date-only P&L cost (P1 contract, never reimplemented). */
export function computeMarketingCost(
  rows: DatedConsumptionInput[],
  range: { start: Date; end: Date },
): MarketingPeriodCost {
  return marketingPeriodCost(
    toFinancialConsumptionRows(rows),
    range.start,
    range.end,
  );
}

export interface AttributedRevenueInput {
  source: string;
  channel: string;
  revenue: number;
}

export interface SourceRevenueRow {
  key: string;
  label: string;
  orders: number;
  revenue: number;
}

export interface SourceRevenueResult {
  sources: SourceRevenueRow[];
  channels: SourceRevenueRow[];
  unattributed: { orders: number; revenue: number };
  total: { orders: number; revenue: number };
}

/** Recognised revenue grouped by Marketing Source and by sales channel. */
export function aggregateSourceRevenue(
  orders: AttributedRevenueInput[],
): SourceRevenueResult {
  const bySource = new Map<string, { orders: number; revenue: number }>();
  const byChannel = new Map<string, { orders: number; revenue: number }>();
  let unattributedOrders = 0;
  let unattributedRevenue = 0;
  for (const o of orders) {
    const s = bySource.get(o.source) ?? { orders: 0, revenue: 0 };
    s.orders += 1;
    s.revenue += o.revenue;
    bySource.set(o.source, s);
    const c = byChannel.get(o.channel) ?? { orders: 0, revenue: 0 };
    c.orders += 1;
    c.revenue += o.revenue;
    byChannel.set(o.channel, c);
    if (o.source === MARKETING_UNATTRIBUTED) {
      unattributedOrders += 1;
      unattributedRevenue += o.revenue;
    }
  }
  const sources = [...bySource.entries()]
    .map(([key, v]) => ({ key, label: key, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  const channels = [...byChannel.entries()]
    .map(([key, v]) => ({ key, label: key, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  return {
    sources,
    channels,
    unattributed: { orders: unattributedOrders, revenue: unattributedRevenue },
    total: { orders: orders.length, revenue: orders.reduce((s, o) => s + o.revenue, 0) },
  };
}

export interface SegmentRevenueEvent {
  key: string;
  at: Date;
  revenue: number;
}

export interface SegmentRevenueResult {
  newOrders: number;
  newRevenue: number;
  returningOrders: number;
  returningRevenue: number;
  /** VIP is a subset of returning (of-which), never a third bucket. */
  vipOrders: number;
  vipRevenue: number;
}

/**
 * New vs returning recognised-revenue split (§2.7 boundary: first-ever
 * recognised in range → New, else Returning; VIP = returning + ≥N lifetime).
 */
export function computeSegmentRevenue(
  events: SegmentRevenueEvent[],
  range: { start: Date; end: Date },
): SegmentRevenueResult {
  const lifetimes = new Map<
    string,
    { firstAt: Date; lifetime: number; rangeOrders: number; rangeRevenue: number }
  >();
  for (const e of events) {
    const entry = lifetimes.get(e.key);
    if (!entry) {
      lifetimes.set(e.key, {
        firstAt: e.at,
        lifetime: 1,
        rangeOrders: e.at >= range.start && e.at <= range.end ? 1 : 0,
        rangeRevenue: e.at >= range.start && e.at <= range.end ? e.revenue : 0,
      });
    } else {
      entry.lifetime += 1;
      if (e.at < entry.firstAt) entry.firstAt = e.at;
      if (e.at >= range.start && e.at <= range.end) {
        entry.rangeOrders += 1;
        entry.rangeRevenue += e.revenue;
      }
    }
  }
  const out: SegmentRevenueResult = {
    newOrders: 0,
    newRevenue: 0,
    returningOrders: 0,
    returningRevenue: 0,
    vipOrders: 0,
    vipRevenue: 0,
  };
  for (const life of lifetimes.values()) {
    if (life.rangeOrders === 0) continue;
    if (life.firstAt >= range.start) {
      out.newOrders += life.rangeOrders;
      out.newRevenue += life.rangeRevenue;
    } else {
      out.returningOrders += life.rangeOrders;
      out.returningRevenue += life.rangeRevenue;
      if (life.lifetime >= VIP_MIN_LIFETIME_RECOGNISED_ORDERS) {
        out.vipOrders += life.rangeOrders;
        out.vipRevenue += life.rangeRevenue;
      }
    }
  }
  return out;
}

export interface AllocationInsightInput {
  orderId: string;
  displayId: string;
  status: string;
  timeline: TimelineEntry[];
  dispatchDeliveredAt: Date | null;
  allocatedCost: number;
  calculatedAt: Date;
  campaignId: string;
  campaignName: string;
}

export interface UnrecognisedSpendRow {
  orderId: string;
  displayId: string;
  status: string;
  campaignId: string;
  campaignName: string;
  allocatedCost: number;
  calculatedAt: string;
}

export interface UnrecognisedSpendResult {
  amount: number;
  allocations: number;
  orders: number;
  rows: UnrecognisedSpendRow[];
}

/**
 * Spend on orders that never recognised revenue (cancelled/undelivered).
 * Lifetime classification (no range check): an order that recognised EVER is
 * excluded. Insight only — the caller must never add `amount` to a ladder.
 */
export function computeUnrecognisedSpend(
  allocations: AllocationInsightInput[],
): UnrecognisedSpendResult {
  const rows: UnrecognisedSpendRow[] = [];
  const orderIds = new Set<string>();
  let amount = 0;
  for (const a of allocations) {
    const rev = resolveRevenueEvent({
      timeline: a.timeline ?? [],
      dispatchDeliveredAt: a.dispatchDeliveredAt,
      currentStatus: a.status,
    });
    if (rev.recognised) continue;
    amount += a.allocatedCost;
    orderIds.add(a.orderId);
    rows.push({
      orderId: a.orderId,
      displayId: a.displayId,
      status: a.status,
      campaignId: a.campaignId,
      campaignName: a.campaignName,
      allocatedCost: a.allocatedCost,
      calculatedAt: a.calculatedAt.toISOString(),
    });
  }
  rows.sort((a, b) => b.allocatedCost - a.allocatedCost);
  return { amount, allocations: rows.length, orders: orderIds.size, rows };
}

// ---------------------------------------------------------------------------
// Campaign → ad set → ad tree (recorded rows only, never recomputed).
// ---------------------------------------------------------------------------

export interface InsightTotalsInput {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
}

export interface CampaignNodeInput {
  id: string;
  name: string;
  status: string;
  adAccount: { id: string; name: string; currency: string } | null;
  platform: { slug: string; name: string } | null;
}

export interface AdSetNodeInput {
  id: string;
  campaignId: string;
  name: string;
  status: string;
}

export interface AdNodeInput {
  id: string;
  adSetId: string;
  name: string;
  status: string;
}

export interface AttributionInput {
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  revenue: number;
}

export interface CampaignTreeNode {
  campaignId: string;
  name: string;
  status: string;
  adAccount: { id: string; name: string; currency: string } | null;
  platform: { slug: string; name: string } | null;
  /** Recorded platform insights, insight-date basis. */
  insights: InsightTotalsInput;
  insightsDateBasis: string;
  /** Intake-basis attribution (Order.createdAt), adapted from the marketing module. */
  store: { orders: number; revenue: number };
  storeDateBasis: string;
  /** Spend-date P&L cost for this campaign. */
  pnlCost: number;
  pnlDateBasis: string;
  undatedCost: { amount: number; rows: number };
  adSets: {
    adSetId: string;
    name: string;
    status: string;
    insights: InsightTotalsInput;
    store: { orders: number; revenue: number };
    ads: {
      adId: string;
      name: string;
      status: string;
      insights: InsightTotalsInput;
      store: { orders: number; revenue: number };
    }[];
  }[];
}

const ZERO_INSIGHTS: InsightTotalsInput = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  purchases: 0,
  purchaseValue: 0,
};

function sumInsights(rows: InsightTotalsInput[]): InsightTotalsInput {
  return rows.reduce(
    (s, r) => ({
      spend: s.spend + r.spend,
      impressions: s.impressions + r.impressions,
      clicks: s.clicks + r.clicks,
      purchases: s.purchases + r.purchases,
      purchaseValue: s.purchaseValue + r.purchaseValue,
    }),
    { ...ZERO_INSIGHTS },
  );
}

export const TREE_INSIGHTS_BASIS = 'insight date (recorded platform snapshot)';
export const TREE_STORE_BASIS =
  'Order.createdAt — attribution intake basis, not recognition';
export const TREE_PNL_BASIS = 'spendDate only';

/** Assemble the campaign tree from recorded rows (pure; no provider reads). */
export function buildCampaignTree(input: {
  campaigns: CampaignNodeInput[];
  adSets: AdSetNodeInput[];
  ads: AdNodeInput[];
  campaignInsights: ({ campaignId: string } & InsightTotalsInput)[];
  adSetInsights: ({ adSetId: string } & InsightTotalsInput)[];
  adInsights: ({ adId: string } & InsightTotalsInput)[];
  attributed: AttributionInput[];
  pnlCostByCampaign: Record<string, number>;
  undatedByCampaign: Record<string, { amount: number; rows: number }>;
}): CampaignTreeNode[] {
  const campaignInsightRows = new Map<string, InsightTotalsInput[]>();
  for (const r of input.campaignInsights) {
    const list = campaignInsightRows.get(r.campaignId) ?? [];
    list.push(r);
    campaignInsightRows.set(r.campaignId, list);
  }
  const adSetInsightRows = new Map<string, InsightTotalsInput[]>();
  for (const r of input.adSetInsights) {
    const list = adSetInsightRows.get(r.adSetId) ?? [];
    list.push(r);
    adSetInsightRows.set(r.adSetId, list);
  }
  const adInsightRows = new Map<string, InsightTotalsInput[]>();
  for (const r of input.adInsights) {
    const list = adInsightRows.get(r.adId) ?? [];
    list.push(r);
    adInsightRows.set(r.adId, list);
  }
  const storeByCampaign = new Map<string, { orders: number; revenue: number }>();
  const storeByAdSet = new Map<string, { orders: number; revenue: number }>();
  const storeByAd = new Map<string, { orders: number; revenue: number }>();
  for (const a of input.attributed) {
    if (a.campaignId) {
      const cur = storeByCampaign.get(a.campaignId) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += a.revenue;
      storeByCampaign.set(a.campaignId, cur);
    }
    if (a.adSetId) {
      const cur = storeByAdSet.get(a.adSetId) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += a.revenue;
      storeByAdSet.set(a.adSetId, cur);
    }
    if (a.adId) {
      const cur = storeByAd.get(a.adId) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += a.revenue;
      storeByAd.set(a.adId, cur);
    }
  }
  const setsByCampaign = new Map<string, AdSetNodeInput[]>();
  for (const s of input.adSets) {
    const list = setsByCampaign.get(s.campaignId) ?? [];
    list.push(s);
    setsByCampaign.set(s.campaignId, list);
  }
  const adsBySet = new Map<string, AdNodeInput[]>();
  for (const ad of input.ads) {
    const list = adsBySet.get(ad.adSetId) ?? [];
    list.push(ad);
    adsBySet.set(ad.adSetId, list);
  }

  const nodes: CampaignTreeNode[] = input.campaigns.map((c) => ({
    campaignId: c.id,
    name: c.name,
    status: c.status,
    adAccount: c.adAccount,
    platform: c.platform,
    insights: sumInsights(campaignInsightRows.get(c.id) ?? []),
    insightsDateBasis: TREE_INSIGHTS_BASIS,
    store: storeByCampaign.get(c.id) ?? { orders: 0, revenue: 0 },
    storeDateBasis: TREE_STORE_BASIS,
    pnlCost: input.pnlCostByCampaign[c.id] ?? 0,
    pnlDateBasis: TREE_PNL_BASIS,
    undatedCost: input.undatedByCampaign[c.id] ?? { amount: 0, rows: 0 },
    adSets: (setsByCampaign.get(c.id) ?? []).map((s) => ({
      adSetId: s.id,
      name: s.name,
      status: s.status,
      insights: sumInsights(adSetInsightRows.get(s.id) ?? []),
      store: storeByAdSet.get(s.id) ?? { orders: 0, revenue: 0 },
      ads: (adsBySet.get(s.id) ?? []).map((ad) => ({
        adId: ad.id,
        name: ad.name,
        status: ad.status,
        insights: sumInsights(adInsightRows.get(ad.id) ?? []),
        store: storeByAd.get(ad.id) ?? { orders: 0, revenue: 0 },
      })),
    })),
  }));
  nodes.sort((a, b) => b.insights.spend - a.insights.spend);
  return nodes;
}

// ---------------------------------------------------------------------------
// Response shapes.
// ---------------------------------------------------------------------------

export interface MarketingSummaryData {
  cost: {
    total: KpiValue;
    datedRows: number;
    undatedRows: number;
    datedAmount: number;
    undatedAmount: number;
    estimatedReference: { label: string; excludedFromTotal: true } | null;
    basisStatement: string;
    allocatedAtNote: string;
  };
  sources: {
    rows: SourceRevenueRow[];
    unattributed: { orders: number; revenue: number };
    dateBasis: string;
  };
  channels: { rows: SourceRevenueRow[]; dateBasis: string };
  segments: {
    newOrders: number;
    newRevenue: number;
    returningOrders: number;
    returningRevenue: number;
    vipOrders: number;
    vipRevenue: number;
    dateBasis: string;
  };
  unrecognisedSpend: {
    amount: number;
    allocations: number;
    orders: number;
    rows: UnrecognisedSpendRow[];
    note: string;
    dateBasis: string;
  };
  attributionDisclosure: string;
}

export interface MarketingCampaignsData {
  campaigns: CampaignTreeNode[];
  disclosure: string;
}

export interface MarketingUndatedRow {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  calculatedCost: number;
  source: string;
  /** allocatedAt as a labelled reference — never a period date. */
  allocatedAt: string | null;
  allocatedAtCaption: string;
  estimatedReference: { label: string; excludedFromTotal: true };
}

export interface MarketingUndatedData {
  rows: MarketingUndatedRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalAmount: number;
  undatedRows: number;
  fixActions: { label: string; href: string }[];
  allocatedAtNote: string;
}

const DATE_BASIS_RECOGNISED = 'Delivered transition — the P&L cohort';
const DATE_BASIS_ALLOCATION = 'calculatedAt — attribution basis, not a P&L date';

@Injectable()
export class AnalyticsMarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly cache: CacheService,
  ) {}

  private costKpi(
    cost: MarketingPeriodCost,
    empty: boolean,
  ): KpiValue {
    if (empty) return kpiNoData('no consumption rows');
    if (cost.state === 'unavailable') {
      return {
        value: cost.total,
        state: 'unavailable',
        reason: `${cost.undatedRows} consumption(s) missing spendDate (৳${cost.undatedAmount})`,
        dateBasis: 'spendDate only',
      };
    }
    if (cost.total === 0) return kpiZero('measured zero');
    return kpiOk(cost.total, { dateBasis: 'spendDate only' });
  }

  private respond<T>(
    data: T,
    ctx: ResolvedAnalyticsContext,
    marketing: { datedRows: number; undatedRows: number; datedAmount: number; undatedAmount: number },
  ): { data: T; meta: AnalyticsMeta } {
    return {
      data,
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: { marketing },
        ladderState: marketing.undatedRows > 0 ? 'unavailable' : 'actual',
        thresholds: {
          vipMinLifetimeRecognisedOrders: VIP_MIN_LIFETIME_RECOGNISED_ORDERS,
        },
        dateBasis:
          'P&L cost spendDate; source/channel/segment revenue Delivered transition; ' +
          'campaign tree insight date + Order.createdAt + spendDate; allocation insights calculatedAt',
      }),
    };
  }

  private async cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMs);
    } catch {
      /* computed response is served regardless */
    }
  }

  /**
   * Recognised-candidate orders with the marketing-revenue projection:
   * line revenue, source/channel keys, segment events. Trashed excluded
   * always; customerSegment narrows server-side (derived, like the ladder).
   */
  private async fetchRevenueCandidates(ctx: ResolvedAnalyticsContext) {
    const { range, filters } = ctx;
    const marketingOrderIds = filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    const rows: any[] = await this.prisma.order.findMany({
      where: { ...where, createdAt: { lte: range.end } },
      select: {
        id: true,
        subtotal: true,
        discount: true,
        discountType: true,
        status: { select: { name: true } },
        timeline: true,
        customerId: true,
        customerPhone: true,
        guestPhone: true,
        salesChannel: true,
        trackingSessionId: true,
        items: { select: { price: true, quantity: true } },
        dispatches: {
          select: { deliveredAt: true },
          orderBy: { deliveredAt: 'desc' },
        },
        orderAttribution: {
          select: {
            campaign: {
              select: {
                adAccount: {
                  select: {
                    connection: {
                      select: { platform: { select: { slug: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const tokens = rows
      .map((o) => o.trackingSessionId)
      .filter((t): t is string => !!t);
    const sessions: any[] =
      tokens.length > 0
        ? await this.prisma.marketingSession.findMany({
            where: { sessionToken: { in: tokens } },
            select: { sessionToken: true, utmSource: true },
          })
        : [];
    const utmByToken = new Map(
      sessions.map((s) => [s.sessionToken, s.utmSource ?? null]),
    );

    let candidates = rows.map((o) => {
      const deliveredAts = (o.dispatches ?? [])
        .map((d: any) => d.deliveredAt)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      const lineGrosses = (o.items ?? []).map(
        (i: any) => Number(i.price) * i.quantity,
      );
      const grossSum = lineGrosses.reduce((s: number, g: number) => s + g, 0);
      const effectiveDiscount =
        o.discountType === 'percentage'
          ? Number(o.subtotal) * (Number(o.discount) / 100)
          : Number(o.discount);
      const revenue = allocateDiscount(lineGrosses, effectiveDiscount).reduce(
        (s, a) => s + a.net,
        0,
      );
      const rev = resolveRevenueEvent({
        timeline: Array.isArray(o.timeline) ? o.timeline : [],
        dispatchDeliveredAt:
          deliveredAts.length > 0
            ? new Date(Math.max(...deliveredAts.map((d: Date) => d.getTime())))
            : null,
        currentStatus: o.status?.name ?? '',
      });
      const session = o.trackingSessionId
        ? { utmSource: utmByToken.get(o.trackingSessionId) ?? null }
        : null;
      return {
        id: o.id,
        revenue,
        grossSum,
        revenueDate: rev.recognised ? rev.revenueDate : null,
        key: customerKeyOf(o),
        source: resolveMarketingSource(o.orderAttribution ?? null, session),
        channel: o.salesChannel ?? 'unspecified',
      };
    });

    // In-cohort: recognised with the revenue date inside the range.
    let inCohort = candidates.filter(
      (c) =>
        c.revenueDate !== null &&
        c.revenueDate >= range.start &&
        c.revenueDate <= range.end,
    );

    if (filters.customerSegment) {
      const history = deriveCustomerSegments(
        candidates
          .filter((c) => c.revenueDate !== null)
          .map((c) => ({ key: c.key, at: c.revenueDate as Date })),
      );
      inCohort = inCohort.filter(
        (c) =>
          this.filters.segmentOf(c.key, range, history) ===
          filters.customerSegment,
      );
    }
    return { inCohort, candidates };
  }

  /** P&L cost + source/channel revenue + segment split + insight (financial). */
  async getSummary(query: AnalyticsFilterDto) {
    const key = analyticsCacheKey('marketing/summary', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;

    const [consumptions, revenue] = await Promise.all([
      this.prisma.marketingConsumption.findMany({
        where: {
          OR: [
            { spendDate: { gte: range.start, lte: range.end } },
            { spendDate: null },
          ],
        },
        select: { calculatedCost: true, spendDate: true },
      }),
      this.fetchRevenueCandidates(ctx),
    ]);
    const allocations: any[] = await this.prisma.marketingCostAllocation.findMany({
      where: {
        calculatedAt: { gte: range.start, lte: range.end },
        order: { trashedAt: null },
      },
      select: {
        allocatedCost: true,
        calculatedAt: true,
        campaignId: true,
        campaign: { select: { name: true } },
        order: {
          select: {
            id: true,
            displayId: true,
            status: { select: { name: true } },
            timeline: true,
            dispatches: {
              select: { deliveredAt: true },
              orderBy: { deliveredAt: 'desc' },
            },
          },
        },
      },
    });

    const cost = computeMarketingCost(
      consumptions.map((c: any) => ({
        calculatedCost: Number(c.calculatedCost),
        spendDate: c.spendDate ? new Date(c.spendDate) : null,
      })),
      range,
    );
    const grouped = aggregateSourceRevenue(
      revenue.inCohort.map((c) => ({
        source: c.source,
        channel: c.channel,
        revenue: c.revenue,
      })),
    );
    const segments = computeSegmentRevenue(
      revenue.candidates
        .filter((c) => c.revenueDate !== null)
        .map((c) => ({
          key: c.key,
          at: c.revenueDate as Date,
          revenue: c.revenue,
        })),
      range,
    );
    const unrecognised = computeUnrecognisedSpend(
      allocations.map((a: any) => {
        const deliveredAts = (a.order.dispatches ?? [])
          .map((d: any) => d.deliveredAt)
          .filter(Boolean)
          .map((d: any) => new Date(d));
        return {
          orderId: a.order.id,
          displayId: a.order.displayId,
          status: a.order.status?.name ?? '',
          timeline: Array.isArray(a.order.timeline) ? a.order.timeline : [],
          dispatchDeliveredAt:
            deliveredAts.length > 0
              ? new Date(
                  Math.max(...deliveredAts.map((d: Date) => d.getTime())),
                )
              : null,
          allocatedCost: Number(a.allocatedCost),
          calculatedAt: new Date(a.calculatedAt),
          campaignId: a.campaignId,
          campaignName: a.campaign?.name ?? a.campaignId,
        };
      }),
    );

    const empty = consumptions.length === 0;
    const response = this.respond(
      {
        cost: {
          total: this.costKpi(cost, empty),
          datedRows: cost.datedRows,
          undatedRows: cost.undatedRows,
          datedAmount: cost.datedAmount,
          undatedAmount: cost.undatedAmount,
          estimatedReference: cost.estimatedReference,
          basisStatement: SPEND_DATE_BASIS_STATEMENT,
          allocatedAtNote: ALLOCATED_AT_NOTE,
        },
        sources: {
          rows: grouped.sources,
          unattributed: grouped.unattributed,
          dateBasis: DATE_BASIS_RECOGNISED,
        },
        channels: { rows: grouped.channels, dateBasis: DATE_BASIS_RECOGNISED },
        segments: { ...segments, dateBasis: DATE_BASIS_RECOGNISED },
        unrecognisedSpend: {
          amount: unrecognised.amount,
          allocations: unrecognised.allocations,
          orders: unrecognised.orders,
          rows: unrecognised.rows.slice(0, 10),
          note: UNRECOGNISED_SPEND_NOTE,
          dateBasis: DATE_BASIS_ALLOCATION,
        },
        attributionDisclosure: ATTRIBUTION_MISMATCH_STATEMENT,
      } satisfies MarketingSummaryData,
      ctx,
      {
        datedRows: cost.datedRows,
        undatedRows: cost.undatedRows,
        datedAmount: cost.datedAmount,
        undatedAmount: cost.undatedAmount,
      },
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Campaign → ad set → ad tree over recorded rows (financial). */
  async getCampaigns(query: AnalyticsFilterDto) {
    const key = analyticsCacheKey('marketing/campaigns', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;

    const [campaignInsights, adSetInsights, adInsights, attributions, consumptions] =
      await Promise.all([
        this.prisma.marketingCampaignInsight.findMany({
          where: { date: { gte: range.start, lte: range.end } },
          select: {
            campaignId: true,
            spend: true,
            impressions: true,
            clicks: true,
            purchases: true,
            purchaseValue: true,
          },
        }),
        this.prisma.marketingAdSetInsight.findMany({
          where: { date: { gte: range.start, lte: range.end } },
          select: {
            adSetId: true,
            spend: true,
            impressions: true,
            clicks: true,
            purchases: true,
            purchaseValue: true,
          },
        }),
        this.prisma.marketingAdInsight.findMany({
          where: { date: { gte: range.start, lte: range.end } },
          select: {
            adId: true,
            spend: true,
            impressions: true,
            clicks: true,
            purchases: true,
            purchaseValue: true,
          },
        }),
        this.prisma.orderAttribution.findMany({
          where: {
            order: { createdAt: { gte: range.start, lte: range.end }, trashedAt: null },
          },
          select: {
            campaignId: true,
            adSetId: true,
            adId: true,
            order: { select: { total: true } },
          },
        }),
        this.prisma.marketingConsumption.findMany({
          where: {
            OR: [
              { spendDate: { gte: range.start, lte: range.end } },
              { spendDate: null },
            ],
          },
          select: { campaignId: true, calculatedCost: true, spendDate: true },
        }),
      ]);

    const campaignIds = new Set<string>();
    for (const r of campaignInsights) campaignIds.add(r.campaignId);
    for (const a of attributions) if (a.campaignId) campaignIds.add(a.campaignId);
    for (const c of consumptions) if (c.campaignId) campaignIds.add(c.campaignId);

    const campaigns: any[] =
      campaignIds.size > 0
        ? await this.prisma.marketingCampaign.findMany({
            where: { id: { in: [...campaignIds] } },
            select: {
              id: true,
              name: true,
              status: true,
              adAccount: {
                select: {
                  id: true,
                  name: true,
                  currency: true,
                  connection: {
                    select: { platform: { select: { slug: true, name: true } } },
                  },
                },
              },
              adSets: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  ads: { select: { id: true, name: true, status: true } },
                },
              },
            },
          })
        : [];

    const pnlCostByCampaign: Record<string, number> = {};
    const undatedByCampaign: Record<string, { amount: number; rows: number }> = {};
    for (const c of consumptions) {
      if (!c.campaignId) continue;
      if (c.spendDate) {
        pnlCostByCampaign[c.campaignId] =
          (pnlCostByCampaign[c.campaignId] ?? 0) + Number(c.calculatedCost);
      } else {
        const cur = undatedByCampaign[c.campaignId] ?? { amount: 0, rows: 0 };
        cur.amount += Number(c.calculatedCost);
        cur.rows += 1;
        undatedByCampaign[c.campaignId] = cur;
      }
    }

    const tree = buildCampaignTree({
      campaigns: campaigns.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        adAccount: c.adAccount
          ? { id: c.adAccount.id, name: c.adAccount.name, currency: c.adAccount.currency }
          : null,
        platform: c.adAccount?.connection?.platform
          ? {
              slug: c.adAccount.connection.platform.slug,
              name: c.adAccount.connection.platform.name,
            }
          : null,
      })),
      adSets: campaigns.flatMap((c: any) =>
        (c.adSets ?? []).map((s: any) => ({
          id: s.id,
          campaignId: c.id,
          name: s.name,
          status: s.status,
        })),
      ),
      ads: campaigns.flatMap((c: any) =>
        (c.adSets ?? []).flatMap((s: any) =>
          (s.ads ?? []).map((ad: any) => ({
            id: ad.id,
            adSetId: s.id,
            name: ad.name,
            status: ad.status,
          })),
        ),
      ),
      campaignInsights: campaignInsights.map((r: any) => ({
        campaignId: r.campaignId,
        spend: Number(r.spend),
        impressions: r.impressions,
        clicks: r.clicks,
        purchases: r.purchases,
        purchaseValue: Number(r.purchaseValue ?? 0),
      })),
      adSetInsights: adSetInsights.map((r: any) => ({
        adSetId: r.adSetId,
        spend: Number(r.spend),
        impressions: r.impressions,
        clicks: r.clicks,
        purchases: r.purchases,
        purchaseValue: Number(r.purchaseValue ?? 0),
      })),
      adInsights: adInsights.map((r: any) => ({
        adId: r.adId,
        spend: Number(r.spend),
        impressions: r.impressions,
        clicks: r.clicks,
        purchases: r.purchases,
        purchaseValue: Number(r.purchaseValue ?? 0),
      })),
      attributed: attributions.map((a: any) => ({
        campaignId: a.campaignId,
        adSetId: a.adSetId,
        adId: a.adId,
        revenue: Number(a.order.total),
      })),
      pnlCostByCampaign,
      undatedByCampaign,
    });

    const cost = computeMarketingCost(
      consumptions.map((c: any) => ({
        calculatedCost: Number(c.calculatedCost),
        spendDate: c.spendDate ? new Date(c.spendDate) : null,
      })),
      range,
    );
    const response = this.respond(
      {
        campaigns: tree,
        disclosure: ATTRIBUTION_MISMATCH_STATEMENT,
      } satisfies MarketingCampaignsData,
      ctx,
      {
        datedRows: cost.datedRows,
        undatedRows: cost.undatedRows,
        datedAmount: cost.datedAmount,
        undatedAmount: cost.undatedAmount,
      },
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Undated-spend coverage fix-list, paginated (financial). */
  async getUndated(query: MarketingQueryDto) {
    const key = analyticsCacheKey('marketing/undated', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { page, pageSize } = marketingPagination(query);

    const [total, rows, totalAgg] = await Promise.all([
      this.prisma.marketingConsumption.count({ where: { spendDate: null } }),
      this.prisma.marketingConsumption.findMany({
        where: { spendDate: null },
        select: {
          id: true,
          campaignId: true,
          calculatedCost: true,
          source: true,
          allocatedAt: true,
          campaign: { select: { name: true } },
        },
        orderBy: { allocatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.marketingConsumption.aggregate({
        _sum: { calculatedCost: true },
        where: { spendDate: null },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data: MarketingUndatedData = {
      rows: (rows as any[]).map((r) => ({
        id: r.id,
        campaignId: r.campaignId,
        campaignName: r.campaign?.name ?? null,
        calculatedCost: Number(r.calculatedCost),
        source: r.source,
        allocatedAt: r.allocatedAt ? new Date(r.allocatedAt).toISOString() : null,
        allocatedAtCaption: UNDATED_ALLOCATED_AT_CAPTION,
        estimatedReference: {
          label: UNDATED_ALLOCATED_AT_CAPTION,
          excludedFromTotal: true as const,
        },
      })),
      total,
      page,
      pageSize,
      totalPages,
      totalAmount: Number(totalAgg._sum.calculatedCost ?? 0),
      undatedRows: total,
      fixActions: [...UNDATED_FIX_ACTIONS],
      allocatedAtNote: ALLOCATED_AT_NOTE,
    };
    const response = this.respond(data, ctx, {
      datedRows: 0,
      undatedRows: total,
      datedAmount: 0,
      undatedAmount: data.totalAmount,
    });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }
}
