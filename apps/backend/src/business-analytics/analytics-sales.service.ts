/**
 * Business analytics sales & orders service (P5, §2.1 lenses + §2.2 returns/
 * refunds + §2.10 full fulfillment panel + §4.2 sales rows + §7.1 + §8.2/8.3/8.7).
 *
 * Lenses side by side, never mixed: L1 Booked (Σ Order.total by createdAt,
 * intake only) · L2 Recognised (the Delivered cohort — the P&L basis, computed
 * through the SAME computePnl as the ladder so the drill path Gross Sales →
 * Net Sales → Sales & Orders foots) · L3 Cash Collected (Σ PAID by
 * Payment.createdAt). Everything before Delivered is never revenue; the
 * pre-delivery pipeline is labelled pipeline and structurally disjoint from
 * the recognised cohort (leak-guard tested).
 *
 * Funnel honesty (§8.7): Add-to-Cart / Checkout-started are not persisted
 * internally — they render "Not instrumented", never zeros. Only stages
 * mapped from real statuses carry counts.
 *
 * Fulfillment economics: the FULL P2 payload is reused (getFulfillment —
 * never recomputed here) plus Return Loss, Refund Leakage and Delivery
 * Income Coverage. Settlement rows reuse the P2 settleOrder pure function
 * (D11 COD honesty preserved: no code path reads Order.total/paymentStatus
 * for collection).
 */
import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  resolveRevenueEvent,
  resolveReturn,
  findDeliveredTransition,
  findReturnTransition,
  allocateDiscount,
  classifyRefund,
  recognitionGroup,
  type TimelineEntry,
} from './metric-contract';
import { collectionKindOf } from './settlement-source';
import {
  AnalyticsFilterService,
  customerKeyOf,
  deriveCustomerSegments,
  type ResolvedAnalyticsContext,
} from './analytics-filter.service';
import type { AnalyticsFilterDto } from './analytics-filter.dto';
import {
  salesPagination,
  type SalesQueryDto,
} from './analytics-sales.dto';
import {
  computePnl,
  type PnlOrderInput,
} from './analytics-pnl.service';
import {
  settleOrder,
  type SettlementRow,
} from './analytics-fulfillment.service';
import { AnalyticsFulfillmentService } from './analytics-fulfillment.service';
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
import {
  bucketEdges,
  fittingGranularity,
} from './analytics-overview.service';

/** Trend honesty bound (same policy as the overview trend). */
export const SALES_TREND_BUCKET_CAP = 366;

// ---------------------------------------------------------------------------
// Pure inputs (Prisma rows mapped to plain numbers before entry).
// ---------------------------------------------------------------------------

export interface SalesOrderInput extends PnlOrderInput {
  displayId: string;
  salesChannel?: string | null;
  source?: string | null;
}

export interface SalesCashInput {
  amount: number;
  status: string;
  gatewayCode: string;
  createdAt: Date;
}

export interface SalesRange {
  start: Date;
  end: Date;
}

// ---------------------------------------------------------------------------
// Lens bases (L1/L2/L3) — each dated on its own basis, never mixed.
// ---------------------------------------------------------------------------

export function bookedInRange(
  orders: Pick<SalesOrderInput, 'total' | 'createdAt'>[],
  range: SalesRange,
): { orders: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const o of orders) {
    if (!o.createdAt) continue;
    if (o.createdAt >= range.start && o.createdAt <= range.end) {
      count += 1;
      amount += o.total;
    }
  }
  return { orders: count, amount };
}

/** L3: PAID payments only, dated by Payment.createdAt. Reversals (PAID→FAILED) drop out. */
export function cashInRange(
  payments: SalesCashInput[],
  range: SalesRange,
): { payments: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const p of payments) {
    if (p.status !== PaymentStatus.PAID) continue;
    if (p.createdAt >= range.start && p.createdAt <= range.end) {
      count += 1;
      amount += p.amount;
    }
  }
  return { payments: count, amount };
}

// ---------------------------------------------------------------------------
// Funnel — supported stages only; unsupported render "Not instrumented".
// ---------------------------------------------------------------------------

export type FunnelStageKey =
  | 'add_to_cart'
  | 'checkout_started'
  | 'booked'
  | 'confirmed'
  | 'packed'
  | 'shipping'
  | 'delivered'
  | 'returned'
  | 'cancelled';

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  instrumented: boolean;
  orders: number | null;
  /** Intake value (Σ Order.total of the cohort reaching the stage). */
  value: number | null;
  /** Fraction of booked reaching this stage (instrumented only). */
  shareOfBooked: number | null;
  /** Fraction converting from the previous linear stage (chain only). */
  conversionFromPrev: number | null;
  dateBasis?: string;
  reason?: string;
}

/** Lifecycle position per status; Cancelled/Returned/Damaged are outcomes, not chain rungs. */
const CHAIN_INDEX: Record<string, number> = {
  Pending: 0,
  'Payment Pending': 0,
  'Payment Verifying': 0,
  Hold: 0,
  Confirmed: 1,
  Packed: 2,
  'Packing Hold': 2,
  Shipping: 3,
  Partial: 3,
  Delivered: 4,
  'Return Pending': 4,
};

const CHAIN_STAGES: { key: FunnelStageKey; label: string; index: number }[] = [
  { key: 'confirmed', label: 'Confirmed', index: 1 },
  { key: 'packed', label: 'Packed', index: 2 },
  { key: 'shipping', label: 'Shipping', index: 3 },
  { key: 'delivered', label: 'Delivered', index: 4 },
];

function timelineReaches(
  timeline: TimelineEntry[],
  index: number,
): boolean {
  return timeline.some((e) => {
    const at = CHAIN_INDEX[e.status];
    return at !== undefined && at >= index;
  });
}

function currentReaches(status: string, index: number): boolean {
  const at = CHAIN_INDEX[status];
  return at !== undefined && at >= index;
}

function hasDeliveredEver(order: Pick<SalesOrderInput, 'timeline' | 'dispatchDeliveredAt'>): boolean {
  if (findDeliveredTransition(order.timeline ?? []) !== null) return true;
  return order.dispatchDeliveredAt !== null && order.dispatchDeliveredAt !== undefined;
}

function hasReturnEver(order: Pick<SalesOrderInput, 'timeline' | 'status'>): boolean {
  if (findReturnTransition(order.timeline ?? []) !== null) return true;
  return order.status === 'Returned' || order.status === 'Damaged';
}

function hasCancelledEver(order: Pick<SalesOrderInput, 'timeline' | 'status'>): boolean {
  if (order.status === 'Cancelled') return true;
  return (order.timeline ?? []).some((e) => e.status === 'Cancelled');
}

export function computeFunnel(
  orders: SalesOrderInput[],
  range: SalesRange,
): FunnelStage[] {
  const cohort = orders.filter(
    (o) => o.createdAt && o.createdAt >= range.start && o.createdAt <= range.end,
  );
  const bookedValue = cohort.reduce((s, o) => s + o.total, 0);
  const reached = (index: number): SalesOrderInput[] =>
    cohort.filter(
      (o) =>
        currentReaches(o.status, index) ||
        timelineReaches(o.timeline ?? [], index) ||
        (index <= 4 && hasDeliveredEver(o)),
    );
  const chainCounts = CHAIN_STAGES.map((s) => ({
    ...s,
    orders: reached(s.index),
  }));
  const deliveredCount = chainCounts[3].orders.length;
  const returned = cohort.filter((o) => hasReturnEver(o));
  const cancelled = cohort.filter((o) => hasCancelledEver(o));

  const stages: FunnelStage[] = [
    {
      key: 'add_to_cart',
      label: 'Add to Cart',
      instrumented: false,
      orders: null,
      value: null,
      shareOfBooked: null,
      conversionFromPrev: null,
      reason: 'Not instrumented — cart events are not persisted internally (§8.7)',
    },
    {
      key: 'checkout_started',
      label: 'Checkout Started',
      instrumented: false,
      orders: null,
      value: null,
      shareOfBooked: null,
      conversionFromPrev: null,
      reason: 'Not instrumented — checkout-start events are not persisted internally (§8.7)',
    },
    {
      key: 'booked',
      label: 'Booked',
      instrumented: true,
      orders: cohort.length,
      value: bookedValue,
      shareOfBooked: cohort.length > 0 ? 1 : null,
      conversionFromPrev: null,
      dateBasis: 'Order.createdAt — intake only',
    },
  ];
  let prev = cohort.length;
  for (const c of chainCounts) {
    const n = c.orders.length;
    stages.push({
      key: c.key,
      label: c.label,
      instrumented: true,
      orders: n,
      value: c.orders.reduce((s, o) => s + o.total, 0),
      shareOfBooked: cohort.length > 0 ? n / cohort.length : null,
      conversionFromPrev: prev > 0 ? n / prev : null,
      dateBasis: 'intake cohort reaching the stage (timeline transition or later status)',
    });
    prev = n;
  }
  void deliveredCount;
  for (const outcome of [
    { key: 'returned' as const, label: 'Returned / Damaged', rows: returned },
    { key: 'cancelled' as const, label: 'Cancelled', rows: cancelled },
  ]) {
    stages.push({
      key: outcome.key,
      label: outcome.label,
      instrumented: true,
      orders: outcome.rows.length,
      value: outcome.rows.reduce((s, o) => s + o.total, 0),
      shareOfBooked: cohort.length > 0 ? outcome.rows.length / cohort.length : null,
      conversionFromPrev: null,
      dateBasis: 'intake cohort ever reaching the outcome (current status or timeline)',
    });
  }
  return stages;
}

// ---------------------------------------------------------------------------
// Pre-delivery pipeline — not-yet-recognised by stage; never revenue.
// ---------------------------------------------------------------------------

export type PipelineStageKey =
  | 'intake'
  | 'confirmed'
  | 'packed'
  | 'shipping'
  | 'flagged'
  | 'undelivered_return'
  | 'cancelled';

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  orders: number;
  /** Σ Order.total — labelled pipeline, never revenue. */
  value: number;
  note: string;
}

const PIPELINE_NOTE = 'pipeline — not revenue (recognised only at Delivered)';

function safeGroup(status: string): string {
  try {
    return recognitionGroup(status);
  } catch {
    // Custom statuses outside the lifecycle vocabulary: surface in the
    // flagged bucket rather than dropping the order silently.
    return 'unrecognised_flagged';
  }
}

export function computePipeline(orders: SalesOrderInput[]): {
  stages: PipelineStage[];
  totalOrders: number;
  totalValue: number;
  /** R11-style leak guard surface: ids that must not appear in any revenue bucket. */
  pipelineOrderIds: string[];
} {
  const buckets = new Map<PipelineStageKey, SalesOrderInput[]>();
  const push = (k: PipelineStageKey, o: SalesOrderInput) => {
    const arr = buckets.get(k) ?? [];
    arr.push(o);
    buckets.set(k, arr);
  };
  for (const order of orders) {
    const rev = resolveRevenueEvent({
      timeline: order.timeline ?? [],
      dispatchDeliveredAt: order.dispatchDeliveredAt ?? null,
      currentStatus: order.status,
    });
    // Ever recognised (Delivered transition or dispatch fallback) ⇒ revenue
    // cohort, never pipeline. Delivered-then-returned excluded here too.
    if (rev.recognised) continue;
    if (order.status === 'Cancelled') {
      push('cancelled', order);
      continue;
    }
    if (order.status === 'Returned' || order.status === 'Damaged') {
      push('undelivered_return', order);
      continue;
    }
    const group = safeGroup(order.status);
    if (group === 'pre_fulfilment') push('intake', order);
    else if (order.status === 'Confirmed') push('confirmed', order);
    else if (order.status === 'Packed' || order.status === 'Packing Hold') push('packed', order);
    else if (order.status === 'Shipping') push('shipping', order);
    else push('flagged', order);
  }
  const defs: { key: PipelineStageKey; label: string }[] = [
    { key: 'intake', label: 'Intake (Pending / Payment Pending / Payment Verifying / Hold)' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'packed', label: 'Packed / Packing Hold' },
    { key: 'shipping', label: 'Shipping' },
    { key: 'flagged', label: 'Flagged (Partial / Return Pending, unrecognised)' },
    { key: 'undelivered_return', label: 'Undelivered returns (no revenue recognised)' },
    { key: 'cancelled', label: 'Cancelled (never recognised)' },
  ];
  const stages: PipelineStage[] = defs.map((d) => {
    const rows = buckets.get(d.key) ?? [];
    return {
      key: d.key,
      label: d.label,
      orders: rows.length,
      value: rows.reduce((s, o) => s + o.total, 0),
      note: PIPELINE_NOTE,
    };
  });
  const pipelineOrderIds = [...buckets.values()].flat().map((o) => o.id);
  return {
    stages,
    totalOrders: pipelineOrderIds.length,
    totalValue: stages.reduce((s, st) => s + st.value, 0),
    pipelineOrderIds,
  };
}

// ---------------------------------------------------------------------------
// Payment / cancellation / return / refund breakdowns.
// ---------------------------------------------------------------------------

export interface PaymentMethodRow {
  gateway: string;
  orders: number;
  amount: number;
  note: string;
}

const MULTI_MATCH_NOTE = 'orders with ≥1 PAID payment of this method (multi-payment orders match multiple methods)';

export function computePaymentBreakdown(
  orders: SalesOrderInput[],
  range: SalesRange,
): { methods: PaymentMethodRow[]; unpaid: { orders: number; bookedValue: number; note: string } } {
  const cohort = orders.filter(
    (o) => o.createdAt && o.createdAt >= range.start && o.createdAt <= range.end,
  );
  const byGateway = new Map<string, { orderIds: Set<string>; amount: number }>();
  let unpaidOrders = 0;
  let unpaidValue = 0;
  for (const o of cohort) {
    const paid = (o.payments ?? []).filter((p) => p.status === PaymentStatus.PAID);
    if (paid.length === 0) {
      unpaidOrders += 1;
      unpaidValue += o.total;
      continue;
    }
    const seen = new Set<string>();
    for (const p of paid) {
      const gw = p.gatewayCode && p.gatewayCode.length > 0 ? p.gatewayCode : 'unknown';
      const entry = byGateway.get(gw) ?? { orderIds: new Set<string>(), amount: 0 };
      entry.amount += p.amount;
      if (!seen.has(gw)) {
        entry.orderIds.add(o.id);
        seen.add(gw);
      }
      byGateway.set(gw, entry);
    }
  }
  const methods: PaymentMethodRow[] = [...byGateway.entries()]
    .map(([gateway, v]) => ({
      gateway,
      orders: v.orderIds.size,
      amount: v.amount,
      note: MULTI_MATCH_NOTE,
    }))
    .sort((a, b) => b.amount - a.amount);
  return {
    methods,
    unpaid: {
      orders: unpaidOrders,
      bookedValue: unpaidValue,
      note: 'intake-cohort orders with zero PAID payments (Σ Order.total — intake value, not revenue)',
    },
  };
}

export type CancelPriorStage = 'intake' | 'confirmed' | 'packed' | 'shipping' | 'delivered';

export interface CancellationBreakdown {
  total: number;
  totalValue: number;
  undated: number;
  dateBasis: string;
  byPriorStage: { stage: CancelPriorStage; orders: number; value: number }[];
  bySalesChannel: { key: string; label: string; orders: number; value: number }[];
}

function priorStageOf(order: SalesOrderInput): CancelPriorStage {
  let best = 0;
  for (const e of order.timeline ?? []) {
    if (e.status === 'Cancelled') continue;
    const at = CHAIN_INDEX[e.status];
    if (at !== undefined && at > best) best = at;
  }
  const cur = CHAIN_INDEX[order.status];
  if (cur !== undefined && cur > best && order.status !== 'Cancelled') best = cur;
  if (hasDeliveredEver(order)) return 'delivered';
  if (best >= 3) return 'shipping';
  if (best >= 2) return 'packed';
  if (best >= 1) return 'confirmed';
  return 'intake';
}

function cancelEventAt(order: SalesOrderInput): Date | null {
  let best: Date | null = null;
  for (const e of order.timeline ?? []) {
    if (e.status !== 'Cancelled') continue;
    const d = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

export function computeCancellations(
  orders: SalesOrderInput[],
  range: SalesRange,
): CancellationBreakdown {
  const cancelled = orders.filter((o) => hasCancelledEver(o));
  const inRange: SalesOrderInput[] = [];
  let undated = 0;
  for (const o of cancelled) {
    const at = cancelEventAt(o);
    if (at === null) {
      undated += 1;
      inRange.push(o);
      continue;
    }
    if (at >= range.start && at <= range.end) inRange.push(o);
  }
  const stageOrder: CancelPriorStage[] = ['intake', 'confirmed', 'packed', 'shipping', 'delivered'];
  const byPriorStage = stageOrder.map((stage) => {
    const rows = inRange.filter((o) => priorStageOf(o) === stage);
    return {
      stage,
      orders: rows.length,
      value: rows.reduce((s, o) => s + o.total, 0),
    };
  });
  const byChannel = new Map<string, { orders: number; value: number }>();
  for (const o of inRange) {
    const key = o.salesChannel ?? 'unspecified';
    const entry = byChannel.get(key) ?? { orders: 0, value: 0 };
    entry.orders += 1;
    entry.value += o.total;
    byChannel.set(key, entry);
  }
  return {
    total: inRange.length,
    totalValue: inRange.reduce((s, o) => s + o.total, 0),
    undated,
    dateBasis: 'Cancelled transition (undated cancels count, never dated)',
    byPriorStage,
    bySalesChannel: [...byChannel.entries()]
      .map(([key, v]) => ({ key, label: key, orders: v.orders, value: v.value }))
      .sort((a, b) => b.value - a.value),
  };
}

/** Σ lineNet under the single §2 discount-allocation definition. */
export function orderLineNet(order: Pick<PnlOrderInput, 'items' | 'discount' | 'discountType' | 'subtotal'>): {
  lineNets: number[];
  net: number;
  gross: number;
  units: number;
} {
  const lineGrosses = order.items.map((i) => i.price * i.quantity);
  const gross = lineGrosses.reduce((s, g) => s + g, 0);
  const effectiveDiscount =
    order.discountType === 'percentage' ? order.subtotal * (order.discount / 100) : order.discount;
  const allocated = allocateDiscount(lineGrosses, effectiveDiscount);
  return {
    lineNets: allocated.map((a) => a.net),
    net: allocated.reduce((s, a) => s + a.net, 0),
    gross,
    units: order.items.reduce((s, i) => s + i.quantity, 0),
  };
}

export interface ReturnBreakdown {
  events: number;
  value: number;
  units: number;
  cogsReversal: number;
  cogsUnavailableUnits: number;
  /** Order-level rate: returnEvents / recognisedOrders (§2.2 — the only defensible order-level figure). */
  rate: number | null;
  rateBasis: string;
  dateBasis: string;
}

export function computeReturnBreakdown(
  orders: SalesOrderInput[],
  range: SalesRange,
  recognisedOrders: number,
): ReturnBreakdown {
  let events = 0;
  let value = 0;
  let units = 0;
  let cogsReversal = 0;
  let cogsUnavailableUnits = 0;
  for (const o of orders) {
    const rev = resolveRevenueEvent({
      timeline: o.timeline ?? [],
      dispatchDeliveredAt: o.dispatchDeliveredAt ?? null,
      currentStatus: o.status,
    });
    const ret = resolveReturn(o.timeline ?? [], rev.revenueDate);
    if (!ret.reversesRevenue || !ret.returnAt) continue;
    if (ret.returnAt < range.start || ret.returnAt > range.end) continue;
    events += 1;
    const { net, units: u } = orderLineNet(o);
    value += net;
    units += u;
    for (const item of o.items) {
      if (item.costSnapshot === null || item.costSnapshot === undefined) {
        cogsUnavailableUnits += item.quantity;
      } else {
        cogsReversal += item.costSnapshot * item.quantity;
      }
    }
  }
  return {
    events,
    value,
    units,
    cogsReversal,
    cogsUnavailableUnits,
    rate: recognisedOrders > 0 ? events / recognisedOrders : null,
    rateBasis: 'returnEvents / recognisedOrders — order-level incidence, never fractional',
    dateBasis: 'return transition (Returned / Damaged)',
  };
}

export interface RefundClasses {
  reversal: { orders: number; amount: number };
  informational: { orders: number; amount: number };
  not_a_reversal: { orders: number; amount: number };
  dateBasis: string;
  crossoverNote: string;
}

export function computeRefundClasses(
  orders: SalesOrderInput[],
  range: SalesRange,
): RefundClasses {
  const acc: Record<'reversal' | 'informational' | 'not_a_reversal', { orderIds: Set<string>; amount: number }> = {
    reversal: { orderIds: new Set(), amount: 0 },
    informational: { orderIds: new Set(), amount: 0 },
    not_a_reversal: { orderIds: new Set(), amount: 0 },
  };
  for (const o of orders) {
    const wasDelivered = hasDeliveredEver(o);
    const wasReturned = findReturnTransition(o.timeline ?? []) !== null;
    for (const r of o.refunds ?? []) {
      if (r.status !== 'completed') continue;
      const at = r.processedAt ?? r.createdAt;
      if (!at || at < range.start || at > range.end) continue;
      const treatment = classifyRefund({ wasDelivered, wasReturned });
      acc[treatment].orderIds.add(o.id);
      acc[treatment].amount += r.amount;
    }
  }
  const out = (k: keyof typeof acc) => ({ orders: acc[k].orderIds.size, amount: acc[k].amount });
  return {
    reversal: out('reversal'),
    informational: out('informational'),
    not_a_reversal: out('not_a_reversal'),
    dateBasis: 'processedAt ?? createdAt',
    crossoverNote:
      'Delivered + returned ⇒ informational only (reversal already taken via Returned Value); never-delivered ⇒ not a reversal (nothing recognised).',
  };
}

// ---------------------------------------------------------------------------
// Fulfillment-economics derivatives: Return Loss + Refund Leakage + coverage.
// ---------------------------------------------------------------------------

export interface ReturnLoss {
  /** Σ(courierCost − deliveryChargeRetained) over online return events (§2.10.2). */
  amount: number;
  events: number;
  unavailableEvents: number;
  note: string;
}

export function computeReturnLoss(
  orders: SalesOrderInput[],
  range: SalesRange,
): ReturnLoss {
  let amount = 0;
  let events = 0;
  let unavailableEvents = 0;
  for (const o of orders) {
    if (collectionKindOf(o.paymentOptionType) !== 'online') continue;
    const rev = resolveRevenueEvent({
      timeline: o.timeline ?? [],
      dispatchDeliveredAt: o.dispatchDeliveredAt ?? null,
      currentStatus: o.status,
    });
    const ret = resolveReturn(o.timeline ?? [], rev.revenueDate);
    if (!ret.reversesRevenue || !ret.returnAt) continue;
    if (ret.returnAt < range.start || ret.returnAt > range.end) continue;
    const row = settleOrder({
      id: o.id,
      paymentOptionType: o.paymentOptionType,
      shippingCharge: o.shippingCharge,
      shippingCost: o.shippingCost,
      shippingCostSource: o.shippingCostSource,
      payments: (o.payments ?? []).map((p) => ({
        amount: p.amount,
        status: p.status,
        gatewayCode: p.gatewayCode,
        createdAt: p.createdAt,
      })),
      refunds: (o.refunds ?? []).map((r) => ({
        amount: r.amount,
        status: r.status,
        createdAt: r.processedAt ?? r.createdAt,
      })),
    });
    const cc = row.courierCost.value;
    const dcr = row.deliveryChargeRetained.value;
    if (cc === null || dcr === null) {
      unavailableEvents += 1;
      continue;
    }
    events += 1;
    amount += cc - dcr;
  }
  return {
    amount,
    events,
    unavailableEvents,
    note: 'Online return events only — COD collection is unavailable (D11), so no COD return loss is computed.',
  };
}

export interface RefundLeakage {
  /** Completed refunds dated in range on orders that were never delivered. */
  amount: number;
  refunds: number;
  orders: number;
  note: string;
}

export function computeRefundLeakage(
  orders: SalesOrderInput[],
  range: SalesRange,
): RefundLeakage {
  let amount = 0;
  let refunds = 0;
  const orderIds = new Set<string>();
  for (const o of orders) {
    if (hasDeliveredEver(o)) continue;
    for (const r of o.refunds ?? []) {
      if (r.status !== 'completed') continue;
      const at = r.processedAt ?? r.createdAt;
      if (!at || at < range.start || at > range.end) continue;
      amount += r.amount;
      refunds += 1;
      orderIds.add(o.id);
    }
  }
  return {
    amount,
    refunds,
    orders: orderIds.size,
    note: 'Refunds on never-delivered orders — not a revenue reversal (nothing was recognised); tracked in Fulfillment Economics.',
  };
}

export interface DeliveryIncomeCoverage {
  onlineOrders: number;
  codOrders: number;
  collectionUnavailableOrders: number;
  unknownAmount: number;
}

export function computeDeliveryCoverage(
  orders: SalesOrderInput[],
): DeliveryIncomeCoverage {
  let onlineOrders = 0;
  let codOrders = 0;
  let unavailable = 0;
  let unknownAmount = 0;
  for (const o of orders) {
    const kind = collectionKindOf(o.paymentOptionType);
    if (kind === 'online') {
      onlineOrders += 1;
    } else {
      codOrders += 1;
      unavailable += 1;
      if (o.shippingCost !== null && o.shippingCost !== undefined) {
        unknownAmount += o.shippingCost;
      }
    }
  }
  return { onlineOrders, codOrders, collectionUnavailableOrders: unavailable, unknownAmount };
}

// ---------------------------------------------------------------------------
// Settlement table rows (per-order, paginated) — reuses the P2 settleOrder.
// ---------------------------------------------------------------------------

export interface SettlementTableRow extends SettlementRow {
  displayId: string;
  status: string;
  createdAt: string | null;
  /** Inference / unavailability disclosure for the disclosure column. */
  disclosure: string | null;
}

export function toSettlementTableRow(order: SalesOrderInput): SettlementTableRow {
  const row = settleOrder({
    id: order.id,
    paymentOptionType: order.paymentOptionType,
    shippingCharge: order.shippingCharge,
    shippingCost: order.shippingCost,
    shippingCostSource: order.shippingCostSource,
    payments: (order.payments ?? []).map((p) => ({
      amount: p.amount,
      status: p.status,
      gatewayCode: p.gatewayCode,
      createdAt: p.createdAt,
    })),
    refunds: (order.refunds ?? []).map((r) => ({
      amount: r.amount,
      status: r.status,
      createdAt: r.processedAt ?? r.createdAt,
    })),
  });
  const disclosure =
    row.deliveryChargeRetained.reason ??
    row.amountCollected.reason ??
    row.fulfillmentMargin.reason ??
    null;
  return {
    ...row,
    displayId: order.displayId,
    status: order.status,
    createdAt: order.createdAt ? order.createdAt.toISOString() : null,
    disclosure,
  };
}

/** Newest-first, page slice with totals (page is 1-based and clamped). */
export function paginateSettlementTable(
  rows: SettlementTableRow[],
  page: number,
  pageSize: number,
): { rows: SettlementTableRow[]; total: number; page: number; pageSize: number; totalPages: number } {
  const sorted = [...rows].sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0;
  });
  const total = sorted.length;
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 20));
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const start = (Math.min(safePage, totalPages) - 1) * safeSize;
  return {
    rows: sorted.slice(start, start + safeSize),
    total,
    page: Math.min(safePage, totalPages),
    pageSize: safeSize,
    totalPages,
  };
}

// ---------------------------------------------------------------------------
// Response shapes.
// ---------------------------------------------------------------------------

export interface SalesTrendSeries {
  bucketStart: string;
  label: string;
  amount: number;
  orders: number;
}

export interface SalesSummaryData {
  lenses: {
    booked: KpiValue;
    recognised: KpiValue;
    cashCollected: KpiValue;
  };
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
  orderMetrics: {
    bookedOrders: KpiValue;
    bookedValue: KpiValue;
    recognisedOrders: KpiValue;
    recognisedValue: KpiValue;
    aovRecognised: KpiValue;
    unitsRecognised: KpiValue;
    cashCollected: KpiValue;
  };
  funnel: FunnelStage[];
  pipeline: {
    stages: PipelineStage[];
    totalOrders: number;
    totalValue: number;
  };
  paymentBreakdown: {
    methods: PaymentMethodRow[];
    unpaid: { orders: number; bookedValue: number; note: string };
  };
  cancellations: CancellationBreakdown;
  returns: ReturnBreakdown;
  refunds: RefundClasses;
  trends: {
    requestedGranularity: string;
    granularity: string;
    booked: SalesTrendSeries[];
    recognised: SalesTrendSeries[];
    cash: SalesTrendSeries[];
  };
  economics: {
    /** FULL P2 fulfillment payload (reused, never recomputed). */
    fulfillment: {
      totals: {
        collected: number;
        refunded: number;
        retained: number;
        courierCost: number;
        deliveryChargeRetained: number;
        fulfillmentMargin: number;
      };
      coverage: DeliveryIncomeCoverage;
      gapBanner: { codOrders: number; courierCost: number; message: string };
      panelNote: string;
    };
    returnLoss: ReturnLoss;
    refundLeakage: RefundLeakage;
    /** Coverage over the sales-table cohort (all filtered orders). */
    coverage: DeliveryIncomeCoverage;
  };
}

export interface SalesSummaryResponse {
  data: SalesSummaryData;
  meta: AnalyticsMeta;
}

@Injectable()
export class AnalyticsSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly fulfillment: AnalyticsFulfillmentService,
    private readonly cache: CacheService,
  ) {}

  private async fetchContext(query: AnalyticsFilterDto): Promise<{
    ctx: ResolvedAnalyticsContext;
    candidates: SalesOrderInput[];
    cash: SalesCashInput[];
  }> {
    const ctx = this.filters.resolveContext(query);
    const { range, filters } = ctx;
    const marketingOrderIds = filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    const { payments: _strippedPaymentsFilter, ...orderPart } = where;
    void _strippedPaymentsFilter;

    // One round-trip per logical group (§6 performance). Orders carry no SQL
    // date predicate: recognition lives in timeline JSONB (Delivered
    // transition) and cross-period cohorts (delivered in range, created
    // earlier) must stay visible — dating happens in JS, as in P2/P3.
    const [orders, cash] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          displayId: true,
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
          shippingCost: true,
          shippingCostSource: true,
          items: {
            select: { price: true, quantity: true, costSnapshot: true, costType: true },
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
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          createdAt: { gte: range.start, lte: range.end },
          ...(filters.paymentMethod ? { gatewayCode: filters.paymentMethod } : {}),
          order: orderPart,
        },
        select: { amount: true, status: true, gatewayCode: true, createdAt: true },
      }),
    ]);

    let candidates = orders.map((o: any): SalesOrderInput => {
      const deliveredAts = (o.dispatches ?? [])
        .map((d: any) => d.deliveredAt)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      return {
        id: o.id,
        displayId: o.displayId,
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
        salesChannel: o.salesChannel,
        source: o.source,
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

    return {
      ctx,
      candidates,
      cash: cash.map((p: any) => ({
        amount: Number(p.amount),
        status: p.status,
        gatewayCode: p.gatewayCode,
        createdAt: new Date(p.createdAt),
      })),
    };
  }

  private buildSummaryData(
    candidates: SalesOrderInput[],
    cash: SalesCashInput[],
    range: SalesRange,
    granularity: string,
  ): Omit<SalesSummaryData, 'economics'> {
    // The recognised lens + Net Sales run through the SAME computePnl as the
    // ladder: the drill path Gross Sales → Net Sales → Sales & Orders foots
    // by construction (marketing/OPEX inputs are empty here — they do not
    // touch Net Sales, lenses or the strip).
    const pnl = computePnl({
      range,
      orders: candidates,
      bookedOrders: candidates
        .filter((o) => o.createdAt)
        .map((o) => ({ createdAt: o.createdAt as Date, total: o.total })),
      cashPayments: cash,
      consumptions: [],
      expenses: [],
    });

    const booked = bookedInRange(candidates, range);
    const cashAgg = cashInRange(cash, range);
    const recognisedValue = pnl.netSales.amount;
    const recognisedOrders = pnl.recognisedOrders;
    const units = candidates.reduce((sum, o) => {
      const rev = resolveRevenueEvent({
        timeline: o.timeline ?? [],
        dispatchDeliveredAt: o.dispatchDeliveredAt ?? null,
        currentStatus: o.status,
      });
      if (!rev.recognised || !rev.revenueDate) return sum;
      if (rev.revenueDate < range.start || rev.revenueDate > range.end) return sum;
      return sum + o.items.reduce((s, i) => s + i.quantity, 0);
    }, 0);

    const funnel = computeFunnel(candidates, range);
    const pipeline = computePipeline(candidates);

    // Three trends on three date bases (Dhaka buckets, §2.1 lenses).
    const effectiveGranularity = fittingGranularity(range.start, range.end, granularity as any);
    const edges = bucketEdges(range.start, range.end, effectiveGranularity as any);
    const bookedTrend: SalesTrendSeries[] = edges.map((edge) => {
      const inBucket = candidates.filter(
        (o) => o.createdAt && o.createdAt >= edge.start && o.createdAt <= edge.end,
      );
      return {
        bucketStart: edge.start.toISOString(),
        label: edge.label,
        amount: inBucket.reduce((s, o) => s + o.total, 0),
        orders: inBucket.length,
      };
    });
    const recognisedTrend: SalesTrendSeries[] = edges.map((edge) => {
      const r = computePnl({
        range: { start: edge.start, end: edge.end },
        orders: candidates,
        bookedOrders: [],
        cashPayments: [],
        consumptions: [],
        expenses: [],
      });
      return {
        bucketStart: edge.start.toISOString(),
        label: edge.label,
        amount: r.netSales.amount,
        orders: r.recognisedOrders,
      };
    });
    const cashTrend: SalesTrendSeries[] = edges.map((edge) => ({
      bucketStart: edge.start.toISOString(),
      label: edge.label,
      amount: cash
        .filter(
          (p) =>
            p.status === PaymentStatus.PAID &&
            p.createdAt >= edge.start &&
            p.createdAt <= edge.end,
        )
        .reduce((s, p) => s + p.amount, 0),
      orders: cash.filter(
        (p) =>
          p.status === PaymentStatus.PAID &&
          p.createdAt >= edge.start &&
          p.createdAt <= edge.end,
      ).length,
    }));

    const money = (amount: number, dateBasis: string): KpiValue =>
      kpiOk(amount, { dateBasis });
    const empty = recognisedOrders === 0;

    return {
      lenses: {
        booked: money(pnl.lenses.booked, 'Order.createdAt — intake only, never in the ladder'),
        recognised: empty
          ? kpiNoData('no recognised orders in range')
          : money(pnl.lenses.recognised, 'Delivered transition — the P&L basis'),
        cashCollected: money(pnl.lenses.cashCollected, 'Payment.createdAt (PAID only)'),
      },
      strip: pnl.strip,
      orderMetrics: {
        bookedOrders: booked.orders > 0
          ? money(booked.orders, 'Order.createdAt')
          : kpiZero('no orders booked in range'),
        bookedValue: money(booked.amount, 'Order.createdAt — Σ Order.total, intake only'),
        recognisedOrders: empty
          ? kpiNoData('no recognised orders in range')
          : money(recognisedOrders, 'Delivered transition'),
        recognisedValue: empty
          ? kpiNoData('no recognised orders in range')
          : money(recognisedValue, 'Delivered transition — Net Sales basis'),
        aovRecognised:
          recognisedOrders > 0
            ? money(recognisedValue / recognisedOrders, 'recognised value ÷ recognised orders')
            : kpiNoData('no recognised orders in range'),
        unitsRecognised: empty
          ? kpiNoData('no recognised orders in range')
          : money(units, 'Σ quantity over the Delivered cohort'),
        cashCollected: money(cashAgg.amount, 'Payment.createdAt (PAID only)'),
      },
      funnel,
      pipeline: {
        stages: pipeline.stages,
        totalOrders: pipeline.totalOrders,
        totalValue: pipeline.totalValue,
      },
      paymentBreakdown: computePaymentBreakdown(candidates, range),
      cancellations: computeCancellations(candidates, range),
      returns: computeReturnBreakdown(candidates, range, recognisedOrders),
      refunds: computeRefundClasses(candidates, range),
      trends: {
        requestedGranularity: granularity,
        granularity: effectiveGranularity,
        booked: bookedTrend,
        recognised: recognisedTrend,
        cash: cashTrend,
      },
    };
  }

  async getSummary(query: AnalyticsFilterDto): Promise<SalesSummaryResponse> {
    const key = analyticsCacheKey('sales-summary', query);
    const cached = await this.cache.get<SalesSummaryResponse>(key);
    if (cached) return cached;
    const { ctx, candidates, cash } = await this.fetchContext(query);
    const { range, filters } = ctx;
    const partial = this.buildSummaryData(
      candidates,
      cash,
      range,
      query.granularity ?? range.granularity,
    );
    // FULL P2 fulfillment payload — reused, never recomputed (§2.10).
    const fulfillment = await this.fulfillment.getFulfillment(query);
    const data: SalesSummaryData = {
      ...partial,
      economics: {
        fulfillment: {
          totals: fulfillment.data.totals,
          coverage: fulfillment.data.coverage,
          gapBanner: fulfillment.data.gapBanner,
          panelNote: fulfillment.data.panelNote,
        },
        returnLoss: computeReturnLoss(candidates, range),
        refundLeakage: computeRefundLeakage(candidates, range),
        coverage: computeDeliveryCoverage(candidates),
      },
    };
    const coverage = computeDeliveryCoverage(candidates);
    const response: SalesSummaryResponse = {
      data,
      meta: buildMeta(ctx, filters, {
        recognition: 'delivered-only',
        costCoverage: { delivery: coverage } as unknown as Record<string, unknown>,
        ladderState: coverage.collectionUnavailableOrders > 0 ? 'unavailable' : 'actual',
        thresholds: { trendBucketCap: SALES_TREND_BUCKET_CAP },
        dateBasis:
          'L1 booked: Order.createdAt · L2 recognised: Delivered transition (dispatch fallback) · L3 cash: Payment.createdAt · returns: return transition · refunds: processedAt ?? createdAt · pipeline: current status, undated-inclusive',
      }),
    };
    try {
      await this.cache.set(key, response, analyticsCacheTtlMs(range));
    } catch {
      /* computed response is served regardless */
    }
    return response;
  }

  async getFunnel(query: AnalyticsFilterDto) {
    const key = analyticsCacheKey('sales-funnel', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const { ctx, candidates } = await this.fetchContext(query);
    const response = {
      data: { stages: computeFunnel(candidates, ctx.range) },
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: {},
        ladderState: 'actual',
        thresholds: {},
        dateBasis: 'intake cohort (Order.createdAt in range); stage reach via timeline transition or later status',
      }),
    };
    try {
      await this.cache.set(key, response, analyticsCacheTtlMs(ctx.range));
    } catch {
      /* computed response is served regardless */
    }
    return response;
  }

  async getPipeline(query: AnalyticsFilterDto) {
    const key = analyticsCacheKey('sales-pipeline', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const { ctx, candidates } = await this.fetchContext(query);
    const pipeline = computePipeline(candidates);
    const response = {
      data: {
        stages: pipeline.stages,
        totalOrders: pipeline.totalOrders,
        totalValue: pipeline.totalValue,
      },
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: {},
        ladderState: 'actual',
        thresholds: {},
        dateBasis: 'current status snapshot — pipeline values are never revenue',
      }),
    };
    try {
      await this.cache.set(key, response, analyticsCacheTtlMs(ctx.range));
    } catch {
      /* computed response is served regardless */
    }
    return response;
  }

  async getSettlement(query: SalesQueryDto) {
    const key = analyticsCacheKey('sales-settlement', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const { ctx, candidates } = await this.fetchContext(query);
    const { page, pageSize } = salesPagination(query);
    const rows = candidates.map(toSettlementTableRow);
    const paged = paginateSettlementTable(rows, page, pageSize);
    const coverage = computeDeliveryCoverage(candidates);
    const fulfillment = await this.fulfillment.getFulfillment(query);
    const response = {
      data: {
        ...paged,
        coverage,
        gapBanner: fulfillment.data.gapBanner,
        panelNote: fulfillment.data.panelNote,
      },
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: { delivery: coverage } as unknown as Record<string, unknown>,
        ladderState: coverage.collectionUnavailableOrders > 0 ? 'unavailable' : 'actual',
        thresholds: {},
        dateBasis: 'per-order settlement over all filtered orders (recognised or not); collection online = Payment.createdAt-confirmed, COD = unavailable (D11)',
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
