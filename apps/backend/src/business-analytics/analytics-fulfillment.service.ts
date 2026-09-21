/**
 * Business analytics fulfillment service (§2.10 Fulfillment / Courier &
 * Refund Economics, D8 + D11).
 *
 * Delivery money lives on its own axis — never blended into recognised
 * revenue or the P&L (R11 leak guard below + test). Online collection is
 * measured from PAID payments; COD/unknown collection is unavailable until a
 * real courier settlement source exists (§2.10.4 seam). courierCost is
 * available for both and is the SAME value deducted once in the ladder.
 */
import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  inferDeliveryChargeRetained,
  resolveRevenueEvent,
  type CostState,
  type ShippingRefundInference,
  type TimelineEntry,
} from './metric-contract';
import {
  collectionKindOf,
  UnavailableSettlementSource,
  type SettlementSource,
} from './settlement-source';
import {
  AnalyticsFilterService,
  type ResolvedAnalyticsContext,
} from './analytics-filter.service';
import type { AnalyticsFilterDto } from './analytics-filter.dto';
import {
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  type AnalyticsMeta,
} from './analytics-envelope.util';

export interface FulfillmentOrderInput {
  id: string;
  paymentOptionType?: string | null;
  shippingCharge: number;
  shippingCost?: number | null;
  shippingCostSource?: 'manual' | 'courier_default' | null;
  payments: { amount: number; status: string; gatewayCode: string; createdAt: Date }[];
  refunds: { amount: number; status: string; createdAt: Date }[];
}

export interface SettlementAmount {
  value: number | null;
  /** Cost state vocabulary (actual | unavailable …), not the KPI envelope. */
  state: CostState;
  reason?: string;
  dateBasis?: string;
}

export interface SettlementRow {
  orderId: string;
  collection: 'online' | 'cod' | 'unknown';
  amountCollected: SettlementAmount;
  amountRefunded: SettlementAmount;
  amountRetained: SettlementAmount;
  deliveryChargeRetained: SettlementAmount & {
    inference: ShippingRefundInference;
  };
  courierCost: SettlementAmount;
  fulfillmentMargin: SettlementAmount;
}

export interface FulfillmentResult {
  rows: SettlementRow[];
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
    /** Courier cost sitting on collection-unavailable orders (COD gap). */
    unknownAmount: number;
  };
  gapBanner: { codOrders: number; courierCost: number; message: string };
  panelNote: string;
}

const PANEL_NOTE =
  'Not part of recognised revenue — delivery money is tracked on its own ' +
  'axis. courierCost is the same underlying cost shown once in the P&L ' +
  'Fulfillment Cost line.';

/** R11 structural guard: settlement rows must carry zero revenue fields. */
export function assertNoRevenueLeak(rows: readonly object[]): void {
  const forbidden = ['grossSales', 'netSales', 'grossProfit', 'contributionProfit', 'netProfit'];
  for (const row of rows) {
    for (const key of forbidden) {
      if (key in row) {
        throw new Error(
          `R11 leak guard: settlement row carries revenue field "${key}"`,
        );
      }
    }
  }
}

const unavailableSettlement = new UnavailableSettlementSource();

export function settleOrder(
  order: FulfillmentOrderInput,
  source: SettlementSource = unavailableSettlement,
): SettlementRow {
  const kind = collectionKindOf(order.paymentOptionType);
  const refunded = order.refunds
    .filter((r) => r.status === 'completed')
    .reduce((s, r) => s + r.amount, 0);
  const refundCount = order.refunds.filter((r) => r.status === 'completed').length;

  const courierValue = order.shippingCost ?? null;
  const courier: SettlementRow['courierCost'] =
    courierValue === null
      ? { value: null, state: 'unavailable', reason: 'shippingCost not recorded', dateBasis: 'recognised order cohort' }
      : {
          value: courierValue,
          state:
            order.shippingCostSource === 'manual'
              ? 'actual'
              : order.shippingCostSource === 'courier_default'
                ? 'estimated'
                : 'unavailable',
          dateBasis: 'recognised order cohort',
        };

  if (kind !== 'online') {
    const cod = source.getCodCollection({ id: order.id });
    return {
      orderId: order.id,
      collection: kind,
      amountCollected: {
        value: cod.amountCollected,
        state: cod.state,
        reason: cod.reason,
      },
      // Refund rows are real data and stay visible even for COD.
      amountRefunded: {
        value: refunded,
        state: 'actual',
        reason: refundCount === 0 ? 'no completed refunds' : undefined,
      },
      amountRetained: {
        value: cod.amountRetained,
        state: cod.state,
        reason: cod.reason,
      },
      deliveryChargeRetained: {
        value: cod.deliveryChargeRetained,
        state: cod.state,
        reason: cod.reason,
        // No shipping-refund inference is ever attempted for COD (D11).
        inference: 'none',
      },
      courierCost: courier,
      fulfillmentMargin: {
        value: cod.fulfillmentMargin,
        state: cod.state,
        reason: cod.reason,
      },
    };
  }

  const collected = order.payments
    .filter((p) => p.status === PaymentStatus.PAID)
    .reduce((s, p) => s + p.amount, 0);
  const retained = collected - refunded;
  const outcome = inferDeliveryChargeRetained({
    shippingCharge: order.shippingCharge,
    refundAmount: refunded,
    collection: 'online',
  });
  const margin =
    outcome.retained !== null && courierValue !== null
      ? outcome.retained - courierValue
      : null;
  return {
    orderId: order.id,
    collection: kind,
    amountCollected: { value: collected, state: 'actual', dateBasis: 'Payment.createdAt' },
    amountRefunded: {
      value: refunded,
      state: 'actual',
      reason: refundCount === 0 ? 'no completed refunds' : undefined,
    },
    amountRetained: { value: retained, state: 'actual' },
    deliveryChargeRetained: {
      value: outcome.retained,
      state: outcome.state,
      inference: outcome.inference,
      reason:
        outcome.inference === 'none'
          ? undefined
          : `shipping-refund inference (${outcome.inference}) — labelled, not measured`,
    },
    courierCost: courier,
    fulfillmentMargin: {
      value: margin,
      state:
        margin !== null && outcome.state === 'actual' && courier.state !== 'unavailable'
          ? 'actual'
          : 'unavailable',
      reason: margin === null ? 'delivery charge or courier cost unavailable' : undefined,
    },
  };
}

export function computeFulfillment(orders: FulfillmentOrderInput[]): FulfillmentResult {
  const rows = orders.map((o) => settleOrder(o));
  assertNoRevenueLeak(rows as unknown as Record<string, unknown>[]);

  let collected = 0;
  let refunded = 0;
  let retained = 0;
  let courierCost = 0;
  let dcr = 0;
  let margin = 0;
  let onlineOrders = 0;
  let codOrders = 0;
  let unavailableOrders = 0;
  let unknownAmount = 0;

  for (const row of rows) {
    if (row.collection === 'online') {
      onlineOrders += 1;
      collected += row.amountCollected.value ?? 0;
      refunded += row.amountRefunded.value ?? 0;
      retained += row.amountRetained.value ?? 0;
      dcr += row.deliveryChargeRetained.value ?? 0;
      if (row.fulfillmentMargin.value !== null) {
        margin += row.fulfillmentMargin.value;
      }
    } else {
      codOrders += 1;
      unavailableOrders += 1;
      // Online-confirmed refunds on COD orders still count as refunded money.
      refunded += row.amountRefunded.value ?? 0;
    }
    if (row.courierCost.value !== null) {
      courierCost += row.courierCost.value;
      if (row.collection !== 'online') unknownAmount += row.courierCost.value;
    }
  }

  return {
    rows,
    totals: {
      collected,
      refunded,
      retained,
      courierCost,
      deliveryChargeRetained: dcr,
      fulfillmentMargin: margin,
    },
    coverage: {
      onlineOrders,
      codOrders,
      collectionUnavailableOrders: unavailableOrders,
      unknownAmount,
    },
    gapBanner: {
      codOrders,
      courierCost: unknownAmount,
      message:
        codOrders > 0
          ? `COD settlement data is not captured. Collection, retained amount and fulfillment margin are unavailable for these ${codOrders} orders (৳${unknownAmount} courier cost). A courier settlement import will supply this.`
          : 'All orders in scope have confirmed collection.',
    },
    panelNote: PANEL_NOTE,
  };
}

@Injectable()
export class AnalyticsFulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly cache: CacheService,
  ) {}

  async getFulfillment(query: AnalyticsFilterDto): Promise<{
    data: FulfillmentResult;
    meta: AnalyticsMeta;
  }> {
    const key = analyticsCacheKey('fulfillment', query);
    const cached = await this.cache.get<{ data: FulfillmentResult; meta: AnalyticsMeta }>(key);
    if (cached) return cached;
    const ctx: ResolvedAnalyticsContext = this.filters.resolveContext(query);
    const marketingOrderIds = ctx.filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(ctx.filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(ctx.filters, marketingOrderIds);
    const orders = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        paymentOptionType: true,
        shippingCharge: true,
        shippingCost: true,
        shippingCostSource: true,
        status: { select: { name: true } },
        timeline: true,
        payments: {
          select: { amount: true, status: true, gatewayCode: true, createdAt: true },
        },
        refunds: { select: { amount: true, status: true, createdAt: true } },
        dispatches: {
          select: { deliveredAt: true },
          orderBy: { deliveredAt: 'desc' },
        },
      },
    });
    // Range scoping (chosen over dropping the range from the cache key):
    // settlement follows the RECOGNISED revenue cohort — the same
    // Delivered-date basis (timeline, Dispatch.deliveredAt fallback) the P&L
    // uses, so the range-keyed cache matches a range-scoped query. The
    // recognition date lives in timeline JSONB and cannot be a SQL
    // predicate, hence in-JS cohort filtering after the column-filter fetch.
    // Residual: per-row payment/refund sums are per-order lifetime sums for
    // cohort orders (consistent with the bridge DCR cohort semantics), not
    // event-dated sums. Undated deliveries stay out of the cohort until
    // dated — they remain visible via the P&L strip + W4.
    const { start, end } = ctx.range;
    const cohort = orders.filter((o: any) => {
      const timeline: TimelineEntry[] = Array.isArray(o.timeline)
        ? (o.timeline as unknown as TimelineEntry[])
        : [];
      const deliveredAts = (o.dispatches ?? [])
        .map((d: any) => d.deliveredAt)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      const rev = resolveRevenueEvent({
        timeline,
        dispatchDeliveredAt:
          deliveredAts.length > 0
            ? new Date(Math.max(...deliveredAts.map((d: Date) => d.getTime())))
            : null,
        currentStatus: o.status?.name ?? '',
      });
      return (
        rev.recognised &&
        rev.revenueDate !== null &&
        rev.revenueDate >= start &&
        rev.revenueDate <= end
      );
    });
    const result = computeFulfillment(
      cohort.map((o: any): FulfillmentOrderInput => ({
        id: o.id,
        paymentOptionType: o.paymentOptionType,
        shippingCharge: Number(o.shippingCharge),
        shippingCost: o.shippingCost === null ? null : Number(o.shippingCost),
        shippingCostSource: o.shippingCostSource,
        payments: (o.payments ?? []).map((p: any) => ({
          amount: Number(p.amount),
          status: p.status,
          gatewayCode: p.gatewayCode,
          createdAt: new Date(p.createdAt),
        })),
        refunds: (o.refunds ?? []).map((r: any) => ({
          amount: Number(r.amount),
          status: r.status,
          createdAt: new Date(r.createdAt),
        })),
      })),
    );
    const response = {
      data: result,
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: { delivery: result.coverage } as unknown as Record<string, unknown>,
        ladderState:
          result.coverage.collectionUnavailableOrders > 0 ? 'unavailable' : 'actual',
        thresholds: {},
        dateBasis: 'recognised order cohort (Delivered transition; dispatch fallback); per-row sums are per-order lifetime',
      }),
    };
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
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
