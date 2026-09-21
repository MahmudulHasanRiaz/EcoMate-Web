/**
 * Business analytics overview service (P3, §3.1 + §4.2 overview rows).
 *
 * Composed read endpoint for the Business Overview page. Reuses the P2
 * services for every financial figure (getPnl / getFulfillment — cached) and
 * the P1 metric contract for all event dating (resolveRevenueEvent,
 * resolveReturn, classifyRefund, allocateDiscount, computePnl). No formula
 * lives here: trend buckets and the comparison window re-run computePnl over
 * the same fetched inputs with different ranges (each period foots
 * independently — cross-period rule, §2.1), and breakdowns allocate order
 * lineNets with the single allocateDiscount definition (§2).
 *
 * Date bases match the ladder: revenue → Delivered transition
 * (Dispatch.deliveredAt fallback); returns → return transition; refunds →
 * processedAt ?? createdAt. Undated deliveries never enter any bucket.
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
  type TimelineEntry,
} from './metric-contract';
import {
  AnalyticsFilterService,
  customerKeyOf,
  deriveCustomerSegments,
} from './analytics-filter.service';
import type { AnalyticsFilterDto } from './analytics-filter.dto';
import {
  computePnl,
  AnalyticsPnlService,
  type PnlOrderInput,
  type PnlResponse,
} from './analytics-pnl.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
import {
  DHAKA_OFFSET_MS,
  dhakaDateParts,
  startOfDhakaDay,
} from '../common/utils/dhaka-time';
import {
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  type AnalyticsMeta,
} from './analytics-envelope.util';
import type { Granularity } from './analytics-range.util';
import { autoGranularity } from './analytics-range.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Trend honesty bound: coarser granularity above this many buckets. */
export const OVERVIEW_TREND_BUCKET_CAP = 366;
/** Breakdown honesty bound: top-N rows, remainder folded into "Other". */
export const OVERVIEW_BREAKDOWN_TOP_N = 8;

export interface TrendPoint {
  bucketStart: string;
  label: string;
  netSales: number;
  grossSales: number;
  recognisedOrders: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  netSales: number;
  orders: number;
}

export interface OverviewComparison {
  prevNetSales: number;
  prevGrossProfit: number;
  prevRecognisedOrders: number;
  prevCashCollected: number;
  prevBooked: number;
  netSalesDelta: number;
  netSalesDeltaPct: number | null;
  recognisedDelta: number;
  cashCollectedDelta: number;
}

export interface OverviewResponse {
  data: {
    /** Full P&L ladder + bridge + lenses + strip + coverage (P2 envelope). */
    pnl: PnlResponse['data'];
    /** Compact fulfillment card: totals + coverage + gap banner + note. */
    fulfillment: {
      totals: {
        collected: number;
        refunded: number;
        retained: number;
        courierCost: number;
        deliveryChargeRetained: number;
        fulfillmentMargin: number;
      };
      coverage: {
        onlineOrders: number;
        codOrders: number;
        collectionUnavailableOrders: number;
        unknownAmount: number;
      };
      gapBanner: { codOrders: number; courierCost: number; message: string };
      panelNote: string;
    };
    comparison: OverviewComparison;
    trend: {
      requestedGranularity: Granularity;
      granularity: Granularity;
      points: TrendPoint[];
    };
    breakdowns: {
      bySalesChannel: BreakdownRow[];
      bySource: BreakdownRow[];
      byCategory: BreakdownRow[];
    };
  };
  meta: AnalyticsMeta;
}

interface BucketEdge {
  start: Date;
  end: Date;
  label: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Dhaka bucket edges for [start, end] at the given granularity. Hour/day/week
 * step in fixed ms (Dhaka is fixed +6, no DST); month steps calendar months
 * in Dhaka parts. Labels are Dhaka-local.
 */
export function bucketEdges(
  start: Date,
  end: Date,
  granularity: Granularity,
): BucketEdge[] {
  const edges: BucketEdge[] = [];
  if (granularity === 'month') {
    const s = dhakaDateParts(start);
    let y = s.year;
    let m = s.month;
    for (;;) {
      const bStart = new Date(Date.UTC(y, m - 1, 1) - DHAKA_OFFSET_MS);
      const nY = m === 12 ? y + 1 : y;
      const nM = m === 12 ? 1 : m + 1;
      const bEnd = new Date(
        new Date(Date.UTC(nY, nM - 1, 1) - DHAKA_OFFSET_MS).getTime() - 1,
      );
      if (bStart > end) break;
      edges.push({
        start: bStart < start ? start : bStart,
        end: bEnd > end ? end : bEnd,
        label: `${y}-${pad2(m)}`,
      });
      if (bEnd >= end) break;
      y = nY;
      m = nM;
    }
    return edges;
  }
  const step = granularity === 'hour' ? HOUR_MS : granularity === 'day' ? DAY_MS : 7 * DAY_MS;
  // Day buckets align to Dhaka midnights; hour/week anchor at range start.
  let cursor =
    granularity === 'day'
      ? startOfDhakaDay(start)
      : new Date(Math.floor(start.getTime() / step) * step);
  if (cursor > start) cursor = new Date(cursor.getTime() - step);
  while (cursor <= end) {
    const bStart = cursor < start ? start : cursor;
    const rawEnd = new Date(cursor.getTime() + step - 1);
    const bEnd = rawEnd > end ? end : rawEnd;
    const p = dhakaDateParts(bStart);
    const label =
      granularity === 'hour'
        ? `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(new Date(bStart.getTime() + DHAKA_OFFSET_MS).getUTCHours())}:00`
        : `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
    edges.push({ start: bStart, end: bEnd, label });
    cursor = new Date(cursor.getTime() + step);
  }
  return edges;
}

/** Step granularity up until the bucket count fits the honesty cap. */
export function fittingGranularity(
  start: Date,
  end: Date,
  requested: Granularity,
): Granularity {
  const order: Granularity[] = ['hour', 'day', 'week', 'month'];
  let idx = order.indexOf(requested);
  while (idx < order.length - 1) {
    if (bucketEdges(start, end, order[idx]).length <= OVERVIEW_TREND_BUCKET_CAP) {
      return order[idx];
    }
    idx += 1;
  }
  return order[idx];
}

@Injectable()
export class AnalyticsOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly pnlService: AnalyticsPnlService,
    private readonly fulfillmentService: AnalyticsFulfillmentService,
    private readonly cache: CacheService,
  ) {}

  async getOverview(query: AnalyticsFilterDto): Promise<OverviewResponse> {
    const key = analyticsCacheKey('overview', query);
    const cached = await this.cache.get<OverviewResponse>(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range, filters } = ctx;
    const granularity = query.granularity ?? range.granularity;
    const effectiveGranularity = fittingGranularity(range.start, range.end, granularity);
    const marketingOrderIds = filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    const { payments: _strippedPaymentsFilter, ...orderPart } = where;
    void _strippedPaymentsFilter;

    // One round-trip per logical group (§6 performance).
    const [pnl, fulfillment, orders, booked, cash] = await Promise.all([
      this.pnlService.getPnl(query),
      this.fulfillmentService.getFulfillment(query),
      this.prisma.order.findMany({
        where: { ...where, createdAt: { lte: range.end } },
        select: {
          id: true,
          total: true,
          subtotal: true,
          shippingCharge: true,
          discount: true,
          discountType: true,
          source: true,
          salesChannel: true,
          status: { select: { name: true } },
          timeline: true,
          createdAt: true,
          paymentOptionType: true,
          customerId: true,
          customerPhone: true,
          guestPhone: true,
          items: {
            select: {
              price: true,
              quantity: true,
              product: {
                select: {
                  category: { select: { id: true, name: true } },
                  productCategories: {
                    select: { category: { select: { id: true, name: true } } },
                  },
                },
              },
              comboComponents: {
                select: {
                  product: {
                    select: {
                      category: { select: { id: true, name: true } },
                      productCategories: {
                        select: { category: { select: { id: true, name: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
          payments: {
            select: { amount: true, status: true, gatewayCode: true, createdAt: true },
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
      // Booked + cash span the comparison window too (prevStart → end), so
      // both current and previous figures come from one fetch each.
      this.prisma.order.findMany({
        where: {
          ...where,
          createdAt: { gte: range.comparison.prevStart, lte: range.end },
        },
        select: { createdAt: true, total: true },
      }),
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          createdAt: { gte: range.comparison.prevStart, lte: range.end },
          ...(filters.paymentMethod ? { gatewayCode: filters.paymentMethod } : {}),
          order: orderPart,
        },
        select: { amount: true, status: true, gatewayCode: true, createdAt: true },
      }),
    ]);

    let candidates: PnlOrderInput[] = orders.map((o: any): PnlOrderInput => {
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
        shippingCost: null,
        shippingCostSource: null,
        items: (o.items ?? []).map((i: any) => ({
          price: Number(i.price),
          quantity: i.quantity,
          costSnapshot: null,
          costType: null,
        })),
        payments: [],
        refunds: (o.refunds ?? []).map((r: any) => ({
          amount: Number(r.amount),
          status: r.status,
          processedAt: r.processedAt ? new Date(r.processedAt) : null,
          createdAt: new Date(r.createdAt),
        })),
      };
    });

    if (filters.customerSegment) {
      // Same derived-segment rule as the P&L (server-side, never client-side).
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

    const emptyRest = {
      bookedOrders: [] as { createdAt: Date; total: number }[],
      cashPayments: [] as never[],
      consumptions: [] as never[],
      expenses: [] as never[],
    };

    // Trend: each bucket foots independently with the period's own events
    // (delivered-then-returned recognises in P1, reverses in P2 — §2.1).
    const edges = bucketEdges(range.start, range.end, effectiveGranularity);
    const points: TrendPoint[] = edges.map((edge) => {
      const r = computePnl({
        range: { start: edge.start, end: edge.end },
        orders: candidates,
        ...emptyRest,
      });
      return {
        bucketStart: edge.start.toISOString(),
        label: edge.label,
        netSales: r.netSales.amount,
        grossSales: r.grossSales.amount,
        recognisedOrders: r.recognisedOrders,
      };
    });

    // Comparison: previous window of identical length (prevEnd = start − 1ms).
    const prev = computePnl({
      range: { start: range.comparison.prevStart, end: range.comparison.prevEnd },
      orders: candidates,
      ...emptyRest,
    });
    const prevBooked = booked
      .filter(
        (b: any) =>
          new Date(b.createdAt) >= range.comparison.prevStart &&
          new Date(b.createdAt) <= range.comparison.prevEnd,
      )
      .reduce((s: number, b: any) => s + Number(b.total), 0);
    const curCash = cash
      .filter(
        (p: any) =>
          new Date(p.createdAt) >= range.start && new Date(p.createdAt) <= range.end,
      )
      .reduce((s: number, p: any) => s + Number(p.amount), 0);
    const prevCash = cash
      .filter(
        (p: any) =>
          new Date(p.createdAt) >= range.comparison.prevStart &&
          new Date(p.createdAt) <= range.comparison.prevEnd,
      )
      .reduce((s: number, p: any) => s + Number(p.amount), 0);
    const curNet = computePnl({ range, orders: candidates, ...emptyRest });
    const comparison: OverviewComparison = {
      prevNetSales: prev.netSales.amount,
      prevGrossProfit: prev.grossProfit.amount,
      prevRecognisedOrders: prev.recognisedOrders,
      prevCashCollected: prevCash,
      prevBooked,
      netSalesDelta: curNet.netSales.amount - prev.netSales.amount,
      netSalesDeltaPct:
        prev.netSales.amount !== 0
          ? ((curNet.netSales.amount - prev.netSales.amount) / Math.abs(prev.netSales.amount)) * 100
          : null,
      recognisedDelta: curNet.recognisedOrders - prev.recognisedOrders,
      cashCollectedDelta: curCash - prevCash,
    };

    const breakdowns = this.buildBreakdowns(candidates, range, orders);

    const response: OverviewResponse = {
      data: {
        pnl: pnl.data,
        fulfillment: {
          totals: fulfillment.data.totals,
          coverage: fulfillment.data.coverage,
          gapBanner: fulfillment.data.gapBanner,
          panelNote: (fulfillment.data as { panelNote?: string }).panelNote ?? '',
        },
        comparison,
        trend: {
          requestedGranularity: granularity,
          granularity: effectiveGranularity,
          points,
        },
        breakdowns,
      },
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: pnl.meta.costCoverage,
        ladderState: pnl.meta.ladderState,
        thresholds: {
          breakdownTopN: OVERVIEW_BREAKDOWN_TOP_N,
          trendBucketCap: OVERVIEW_TREND_BUCKET_CAP,
        },
        dateBasis:
          'revenue-date (Delivered); refunds processedAt; trend + comparison reuse the ladder event dates; breakdowns over the recognised cohort',
      }),
    };
    try {
      await this.cache.set(key, response, analyticsCacheTtlMs(ctx.range));
    } catch {
      /* computed response is served regardless */
    }
    return response;
  }

  /**
   * Top-N breakdowns over the recognised cohort. Channel (salesChannel) and
   * Source (Order.source) are never merged (§4.1, F8). Category uses each
   * line's primary category (product.category, else first ProductCategory,
   * else uncategorised) so every taka is counted once; combo lines expand to
   * their components.
   */
  private buildBreakdowns(
    candidates: PnlOrderInput[],
    range: { start: Date; end: Date },
    rawOrders: any[],
  ): OverviewResponse['data']['breakdowns'] {
    const byChannel = new Map<string, { netSales: number; orders: number }>();
    const bySource = new Map<string, { netSales: number; orders: number }>();
    const byCategory = new Map<string, { label: string; netSales: number; orders: number }>();
    const rawById = new Map<string, any>(rawOrders.map((o: any) => [o.id, o]));

    for (const order of candidates) {
      const rev = resolveRevenueEvent({
        timeline: order.timeline ?? [],
        dispatchDeliveredAt: order.dispatchDeliveredAt ?? null,
        currentStatus: order.status,
      });
      if (!rev.recognised || !rev.revenueDate) continue;
      if (rev.revenueDate < range.start || rev.revenueDate > range.end) continue;
      const raw = rawById.get(order.id) ?? {};

      const lineGrosses = order.items.map((i) => i.price * i.quantity);
      const grossSum = lineGrosses.reduce((s, g) => s + g, 0);
      const effectiveDiscount =
        order.discountType === 'percentage'
          ? (raw.subtotal !== undefined ? Number(raw.subtotal) : grossSum) *
            (order.discount / 100)
          : order.discount;
      // Discount allocation: the single §2 definition (never re-implemented).
      const allocated = allocateDiscount(lineGrosses, effectiveDiscount);
      const lineNets = allocated.map((a) => a.net);

      // Event-dated reversals in range reduce the cohort figure (same rule
      // as the ladder: return transition, else dated refund reversal).
      const ret = resolveReturn(order.timeline ?? [], rev.revenueDate);
      let orderNet = lineNets.reduce((s, n) => s + n, 0);
      if (ret.reversesRevenue && ret.returnAt && ret.returnAt >= range.start && ret.returnAt <= range.end) {
        orderNet = 0;
      } else {
        const wasReturned = ret.reversesRevenue && ret.returnAt !== null;
        for (const refund of order.refunds) {
          if (refund.status !== 'completed') continue;
          const treatment = classifyRefund({ wasDelivered: true, wasReturned });
          const at = refund.processedAt ?? refund.createdAt;
          if (treatment === 'reversal' && at >= range.start && at <= range.end) {
            orderNet -= refund.amount;
          }
        }
      }

      const channelKey = (raw.salesChannel as string) ?? 'unspecified';
      const sourceKey = (raw.source as string) ?? 'unspecified';
      const ch = byChannel.get(channelKey) ?? { netSales: 0, orders: 0 };
      ch.netSales += orderNet;
      ch.orders += 1;
      byChannel.set(channelKey, ch);
      const so = bySource.get(sourceKey) ?? { netSales: 0, orders: 0 };
      so.netSales += orderNet;
      so.orders += 1;
      bySource.set(sourceKey, so);

      const rawItems: any[] = raw.items ?? [];
      order.items.forEach((item, idx) => {
        const rawItem = rawItems[idx] ?? {};
        const components: any[] = rawItem.comboComponents ?? [];
        const hosts: any[] = components.length > 0
          ? components.map((c) => c.product)
          : [rawItem.product];
        const lineNet = lineNets[idx] ?? 0;
        const share = lineNet / Math.max(hosts.length, 1);
        for (const host of hosts) {
          const primary =
            host?.category ?? host?.productCategories?.[0]?.category ?? null;
          const key = primary?.id ?? 'uncategorised';
          const label = primary?.name ?? 'Uncategorised';
          const entry = byCategory.get(key) ?? { label, netSales: 0, orders: 0 };
          entry.netSales += share;
          entry.orders += 1;
          byCategory.set(key, entry);
        }
      });
    }

    const top = (
      entries: [string, { label?: string; netSales: number; orders: number }][],
    ): BreakdownRow[] => {
      const sorted = [...entries].sort((a, b) => b[1].netSales - a[1].netSales);
      const head = sorted.slice(0, OVERVIEW_BREAKDOWN_TOP_N);
      const rest = sorted.slice(OVERVIEW_BREAKDOWN_TOP_N);
      const rows: BreakdownRow[] = head.map(([key, v]) => ({
        key,
        label: v.label ?? key,
        netSales: v.netSales,
        orders: v.orders,
      }));
      if (rest.length > 0) {
        rows.push({
          key: 'other',
          label: `Other (${rest.length})`,
          netSales: rest.reduce((s, [, v]) => s + v.netSales, 0),
          orders: rest.reduce((s, [, v]) => s + v.orders, 0),
        });
      }
      return rows;
    };

    return {
      bySalesChannel: top([...byChannel.entries()].map(([k, v]) => [k, v] as [string, { netSales: number; orders: number }])),
      bySource: top([...bySource.entries()].map(([k, v]) => [k, v] as [string, { netSales: number; orders: number }])),
      byCategory: top([...byCategory.entries()]),
    };
  }
}

// Re-exported so unit tests can assert the auto-granularity policy surface.
export { autoGranularity };
