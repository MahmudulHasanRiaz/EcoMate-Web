/**
 * Business analytics customers service (P6, §2.7 customer metrics).
 *
 * Recognised-orders-only metrics (D4 — the same resolveRevenueEvent gate as
 * the ladder, never duplicated). Identity: CustomerProfile.id; guests keyed
 * by normalized phone (phone-utils.ts normalizePhone, shared with the filter
 * service's customerKeyOf); phone-less guests are counted in
 * `unattributedCustomers` and are NEVER merged into a shared bucket.
 *
 * Vocabulary (§2.7, limitation 11): the cumulative figure is Customer
 * Lifetime Revenue (CLR) — observed cumulative revenue over recognised
 * orders. The predictive-model token this comment must never name never
 * appears in this module: no predictive model exists.
 *
 * Revenue basis per order = Σ lineNet (lineGross − allocatedDiscount, the
 * single §2 discount definition) — delivery charge is never inside (F10).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  resolveRevenueEvent,
  allocateDiscount,
  type TimelineEntry,
} from './metric-contract';
import {
  AnalyticsFilterService,
  VIP_MIN_LIFETIME_RECOGNISED_ORDERS,
  VIP_POLICY_RATIONALE,
  customerKeyOf,
  deriveCustomerSegments,
  type ResolvedAnalyticsContext,
} from './analytics-filter.service';
import {
  customersPagination,
  type CustomersQueryDto,
} from './analytics-customers.dto';
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

/** CLR disclosure — observed, never predictive (limitation 11). */
export const CLR_STATEMENT =
  'Customer Lifetime Revenue (CLR) is observed cumulative revenue over delivery-recognised orders. No predictive model exists.';

/** Phone-less guests can never be linked (limitation 12, warning W9). */
export const UNATTRIBUTED_STATEMENT =
  'Phone-less guest orders cannot be linked to a customer. Each is counted singly and never merged.';

/** Cohort honesty: a window under two calendar months states it (§2.7). */
export const COHORT_INSUFFICIENT_HISTORY = 'insufficient_history';
export const COHORT_INSUFFICIENT_REASON =
  'Retention needs at least two calendar months in the window — cohorts are stated, never partial.';

// ---------------------------------------------------------------------------
// Pure inputs (Prisma rows mapped to plain numbers before entry).
// ---------------------------------------------------------------------------

export interface CustomerOrderItemInput {
  price: number;
  quantity: number;
}

export interface CustomerOrderInput {
  id: string;
  displayId: string;
  subtotal: number;
  discount: number;
  discountType: 'flat' | 'percentage';
  status: string;
  timeline: TimelineEntry[];
  dispatchDeliveredAt?: Date | null;
  customerId?: string | null;
  customerPhone?: string | null;
  guestPhone?: string | null;
  items: CustomerOrderItemInput[];
}

export interface CustomerRange {
  start: Date;
  end: Date;
}

function inRange(at: Date, range: CustomerRange): boolean {
  return at >= range.start && at <= range.end;
}

/** Recognised revenue of one order: Σ lineNet (F10 — delivery excluded). */
export function orderCustomerRevenue(order: CustomerOrderInput): number {
  const lineGrosses = order.items.map((i) => i.price * i.quantity);
  const effectiveDiscount =
    order.discountType === 'percentage'
      ? order.subtotal * (order.discount / 100)
      : order.discount;
  return allocateDiscount(lineGrosses, effectiveDiscount).reduce(
    (s, a) => s + a.net,
    0,
  );
}

export interface CustomerEvent {
  key: string;
  at: Date;
  revenue: number;
  orderId: string;
  displayId: string;
}

export interface CustomerLifetime {
  key: string;
  firstAt: Date;
  lifetime: number;
  lifetimeRevenue: number;
  rangeOrders: number;
  rangeRevenue: number;
  orderIds: string[];
}

export interface CustomerMetricsResult {
  /** Distinct attributed customers with ≥1 recognised order in range. */
  customersInRange: number;
  newCustomers: number;
  returningCustomers: number;
  /** ≥2 lifetime recognised ÷ ≥1 (attributed keys only). */
  repeatRate: number | null;
  rangeRevenue: number;
  rangeOrders: number;
  revenuePerCustomer: number | null;
  ordersPerCustomer: number | null;
  averageCustomerOrderValue: number | null;
  /** Observed cumulative revenue over ALL attributed lifetime keys. */
  cumulativeClr: number;
  lifetimes: Map<string, CustomerLifetime>;
  unattributed: { orders: number; customers: number; revenue: number };
}

export function computeCustomerMetrics(input: {
  range: CustomerRange;
  orders: CustomerOrderInput[];
}): CustomerMetricsResult {
  const { range, orders } = input;
  const unattributed = { orders: 0, customers: 0, revenue: 0 };
  const lifetimes = new Map<string, CustomerLifetime>();

  for (const order of orders) {
    const rev = resolveRevenueEvent({
      timeline: order.timeline ?? [],
      dispatchDeliveredAt: order.dispatchDeliveredAt ?? null,
      currentStatus: order.status,
    });
    // Recognised-only: pre-delivery orders never enter customer metrics.
    if (!rev.recognised || !rev.revenueDate) continue;
    const revenue = orderCustomerRevenue(order);
    const key = customerKeyOf(order);
    if (key === 'unattributed') {
      // Phone-less guests: counted singly, never merged (limitation 12).
      if (inRange(rev.revenueDate, range)) {
        unattributed.orders += 1;
        unattributed.customers += 1;
        unattributed.revenue += revenue;
      }
      continue;
    }
    let life = lifetimes.get(key);
    if (!life) {
      life = {
        key,
        firstAt: rev.revenueDate,
        lifetime: 0,
        lifetimeRevenue: 0,
        rangeOrders: 0,
        rangeRevenue: 0,
        orderIds: [],
      };
      lifetimes.set(key, life);
    }
    life.lifetime += 1;
    life.lifetimeRevenue += revenue;
    if (rev.revenueDate < life.firstAt) life.firstAt = rev.revenueDate;
    if (inRange(rev.revenueDate, range)) {
      life.rangeOrders += 1;
      life.rangeRevenue += revenue;
      life.orderIds.push(order.id);
    }
  }

  let newCustomers = 0;
  let returningCustomers = 0;
  let repeat = 0;
  let withLifetime = 0;
  let rangeRevenue = 0;
  let rangeOrders = 0;
  let cumulativeClr = 0;
  let customersInRange = 0;
  for (const life of lifetimes.values()) {
    withLifetime += 1;
    cumulativeClr += life.lifetimeRevenue;
    if (life.lifetime >= 2) repeat += 1;
    if (life.rangeOrders > 0) {
      customersInRange += 1;
      rangeRevenue += life.rangeRevenue;
      rangeOrders += life.rangeOrders;
      // Boundary (§2.7): first-ever recognised in range → New, else Returning.
      if (life.firstAt >= range.start) newCustomers += 1;
      else returningCustomers += 1;
    }
  }

  return {
    customersInRange,
    newCustomers,
    returningCustomers,
    repeatRate: withLifetime > 0 ? repeat / withLifetime : null,
    rangeRevenue,
    rangeOrders,
    revenuePerCustomer: customersInRange > 0 ? rangeRevenue / customersInRange : null,
    ordersPerCustomer: customersInRange > 0 ? rangeOrders / customersInRange : null,
    averageCustomerOrderValue: rangeOrders > 0 ? rangeRevenue / rangeOrders : null,
    cumulativeClr,
    lifetimes,
    unattributed,
  };
}

// ---------------------------------------------------------------------------
// Cohorts: acquisition month × retention × cumulative CLR.
// ---------------------------------------------------------------------------

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Distinct calendar months touched by the window, ascending. */
export function windowMonths(range: CustomerRange): string[] {
  const months: string[] = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  const last = monthKey(range.end);
  for (;;) {
    const key = monthKey(cursor);
    months.push(key);
    if (key === last) break;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

export interface CohortRow {
  acquisitionMonth: string;
  size: number;
  retention: { month: string; offset: number; active: number; rate: number | null }[];
  /** Observed cumulative revenue of the cohort's members. */
  cumulativeClr: number;
  rangeRevenue: number;
}

export type CohortResult =
  | { state: 'ok'; cohorts: CohortRow[]; months: string[] }
  | { state: 'insufficient_history'; reason: string; months: string[] };

export function computeCohorts(input: {
  range: CustomerRange;
  orders: CustomerOrderInput[];
}): CohortResult {
  const months = windowMonths(input.range);
  // Stated, never partial: under two calendar months there is no cohort table.
  if (months.length < 2) {
    return {
      state: COHORT_INSUFFICIENT_HISTORY as 'insufficient_history',
      reason: COHORT_INSUFFICIENT_REASON,
      months,
    };
  }
  const metrics = computeCustomerMetrics(input);
  const byAcquisition = new Map<string, CustomerLifetime[]>();
  for (const life of metrics.lifetimes.values()) {
    const key = monthKey(life.firstAt);
    const list = byAcquisition.get(key) ?? [];
    list.push(life);
    byAcquisition.set(key, list);
  }
  // Month → members active (≥1 recognised order dated in that month).
  const activeInMonth = new Map<string, Set<string>>();
  for (const order of input.orders) {
    const rev = resolveRevenueEvent({
      timeline: order.timeline ?? [],
      dispatchDeliveredAt: order.dispatchDeliveredAt ?? null,
      currentStatus: order.status,
    });
    if (!rev.recognised || !rev.revenueDate) continue;
    const key = customerKeyOf(order);
    if (key === 'unattributed') continue;
    const set =
      activeInMonth.get(monthKey(rev.revenueDate)) ?? new Set<string>();
    set.add(key);
    activeInMonth.set(monthKey(rev.revenueDate), set);
  }
  const cohorts: CohortRow[] = [...byAcquisition.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([acquisitionMonth, members]) => {
      const startIdx = months.indexOf(acquisitionMonth);
      // Retention runs over the window months at/after acquisition; a cohort
      // acquired before the window still reports its in-window retention.
      const offsets = (startIdx >= 0 ? months.slice(startIdx) : months).map(
        (month, offset) => {
          const active = activeInMonth.get(month);
          const count = members.filter((m) => active?.has(m.key)).length;
          return {
            month,
            offset: startIdx >= 0 ? offset : offset,
            active: count,
            rate: members.length > 0 ? count / members.length : null,
          };
        },
      );
      return {
        acquisitionMonth,
        size: members.length,
        retention: offsets,
        cumulativeClr: members.reduce((s, m) => s + m.lifetimeRevenue, 0),
        rangeRevenue: members.reduce((s, m) => s + m.rangeRevenue, 0),
      };
    });
  return { state: 'ok', cohorts, months };
}

// ---------------------------------------------------------------------------
// Enveloped rows.
// ---------------------------------------------------------------------------

export type CustomerSegmentLabel = 'new' | 'returning' | 'vip';

export function segmentOfLifetime(
  life: CustomerLifetime,
  range: CustomerRange,
): CustomerSegmentLabel {
  if (life.firstAt >= range.start) return 'new';
  if (life.lifetime >= VIP_MIN_LIFETIME_RECOGNISED_ORDERS) return 'vip';
  return 'returning';
}

export interface CustomerRow {
  key: string;
  kind: 'profile' | 'guest';
  profileId: string | null;
  phone: string | null;
  name: string | null;
  segment: CustomerSegmentLabel;
  firstRecognisedAt: string;
  lifetimeOrders: number;
  /** Observed cumulative revenue for this customer. */
  lifetimeRevenue: number;
  rangeOrders: number;
  rangeRevenue: number;
}

const DATE_BASIS_REVENUE = 'Delivered transition — the P&L basis';
const DATE_BASIS_COHORT = 'first-ever recognised order (acquisition month)';

@Injectable()
export class AnalyticsCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly cache: CacheService,
  ) {}

  private money(
    amount: number | null,
    opts: { dateBasis: string; empty: boolean; reason?: string },
  ): KpiValue {
    if (opts.empty) return kpiNoData('no recognised customers in range');
    if (amount === null) {
      return {
        value: null,
        state: 'no_data',
        reason: opts.reason ?? 'no recognised customers in range',
        dateBasis: opts.dateBasis,
      };
    }
    if (amount === 0) return kpiZero(opts.reason ?? 'measured zero');
    return kpiOk(amount, { dateBasis: opts.dateBasis });
  }

  private count(
    value: number,
    opts: { dateBasis: string; empty: boolean },
  ): KpiValue {
    if (opts.empty) return kpiNoData('no recognised customers in range');
    if (value === 0) return kpiZero('measured zero');
    return kpiOk(value, { dateBasis: opts.dateBasis });
  }

  private async fetchCandidates(ctx: ResolvedAnalyticsContext) {
    const { range, filters } = ctx;
    const marketingOrderIds = filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    const rows = await this.prisma.order.findMany({
      // Same wider-window rule as the ladder: recognition dates live in
      // timeline JSONB; createdAt <= range.end is the only safe SQL bound, so
      // pre-range history (the Returning boundary) is visible.
      where: { ...where, createdAt: { lte: range.end } },
      select: {
        id: true,
        displayId: true,
        subtotal: true,
        discount: true,
        discountType: true,
        status: { select: { name: true } },
        timeline: true,
        customerId: true,
        customerPhone: true,
        guestPhone: true,
        customer: { select: { id: true, name: true, phone: true } },
        items: { select: { price: true, quantity: true } },
        dispatches: {
          select: { deliveredAt: true },
          orderBy: { deliveredAt: 'desc' },
        },
      },
    });
    return rows.map((o: any): CustomerOrderInput & { profile?: { id: string; name: string; phone: string } | null } => {
      const deliveredAts = (o.dispatches ?? [])
        .map((d: any) => d.deliveredAt)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      return {
        id: o.id,
        displayId: o.displayId,
        subtotal: Number(o.subtotal),
        discount: Number(o.discount),
        discountType: o.discountType === 'percentage' ? 'percentage' : 'flat',
        status: o.status?.name ?? '',
        timeline: Array.isArray(o.timeline) ? (o.timeline as any) : [],
        dispatchDeliveredAt:
          deliveredAts.length > 0
            ? new Date(Math.max(...deliveredAts.map((d: Date) => d.getTime())))
            : null,
        customerId: o.customerId,
        customerPhone: o.customerPhone,
        guestPhone: o.guestPhone,
        items: (o.items ?? []).map((i: any) => ({
          price: Number(i.price),
          quantity: i.quantity,
        })),
        profile: o.customer ?? null,
      };
    });
  }

  private applyCustomerSegment(
    candidates: (CustomerOrderInput & { profile?: unknown })[],
    ctx: ResolvedAnalyticsContext,
  ): (CustomerOrderInput & { profile?: unknown })[] {
    const { range, filters } = ctx;
    if (!filters.customerSegment) return candidates;
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
    return candidates.filter(
      (order) =>
        this.filters.segmentOf(customerKeyOf(order), range, history) ===
        filters.customerSegment,
    );
  }

  private profileOf(
    candidates: (CustomerOrderInput & { profile?: { id: string; name: string; phone: string } | null })[],
  ): Map<string, { id: string; name: string; phone: string }> {
    const map = new Map<string, { id: string; name: string; phone: string }>();
    for (const c of candidates) {
      if (c.profile && c.customerId) map.set(`customer:${c.customerId}`, c.profile);
    }
    return map;
  }

  private rowsFrom(
    metrics: CustomerMetricsResult,
    range: CustomerRange,
    profiles: Map<string, { id: string; name: string; phone: string }>,
  ): CustomerRow[] {
    return [...metrics.lifetimes.values()]
      .filter((l) => l.rangeOrders > 0)
      .map((l) => {
        const isProfile = l.key.startsWith('customer:');
        const profile = profiles.get(l.key);
        return {
          key: l.key,
          kind: (isProfile ? 'profile' : 'guest') as 'profile' | 'guest',
          profileId: isProfile ? l.key.slice('customer:'.length) : null,
          phone: isProfile
            ? (profile?.phone ?? null)
            : l.key.startsWith('phone:')
              ? l.key.slice('phone:'.length)
              : null,
          name: profile?.name ?? null,
          segment: segmentOfLifetime(l, range),
          firstRecognisedAt: l.firstAt.toISOString(),
          lifetimeOrders: l.lifetime,
          lifetimeRevenue: l.lifetimeRevenue,
          rangeOrders: l.rangeOrders,
          rangeRevenue: l.rangeRevenue,
        };
      })
      .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue);
  }

  private respond<T>(
    data: T,
    ctx: ResolvedAnalyticsContext,
    metrics: CustomerMetricsResult,
  ): { data: T; meta: AnalyticsMeta } {
    return {
      data,
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: {
          unattributedOrders: metrics.unattributed.orders,
          unattributedRevenue: metrics.unattributed.revenue,
        },
        ladderState: 'actual',
        thresholds: {
          vipMinLifetimeRecognisedOrders: VIP_MIN_LIFETIME_RECOGNISED_ORDERS,
          vipPolicyRationale: VIP_POLICY_RATIONALE,
        },
        dateBasis:
          'revenue-date (Delivered); acquisition from first-ever recognised order; repeat over lifetime recognised orders',
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

  /** Acquisition + new/returning + repeat + CLR summary (financial — revenue shown). */
  async getSummary(query: CustomersQueryDto) {
    const key = analyticsCacheKey('customers/summary', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const raw = await this.fetchCandidates(ctx);
    const candidates = this.applyCustomerSegment(raw, ctx);
    const metrics = computeCustomerMetrics({ range: ctx.range, orders: candidates });
    const empty = metrics.customersInRange === 0;
    const base = { dateBasis: DATE_BASIS_REVENUE, empty };
    const response = this.respond(
      {
        acquisition: {
          newCustomers: this.count(metrics.newCustomers, base),
          returningCustomers: this.count(metrics.returningCustomers, base),
          totalCustomers: this.count(metrics.customersInRange, base),
        },
        repeat: {
          rate:
            metrics.repeatRate === null || empty
              ? { value: null, state: 'no_data', reason: 'no recognised customers in range', dateBasis: DATE_BASIS_COHORT }
              : {
                  value: metrics.repeatRate,
                  state: 'ok' as const,
                  reason: 'customers with ≥2 lifetime recognised orders ÷ customers with ≥1',
                  dateBasis: DATE_BASIS_COHORT,
                },
        },
        value: {
          revenuePerCustomer: this.money(metrics.revenuePerCustomer, base),
          ordersPerCustomer: this.money(metrics.ordersPerCustomer, {
            ...base,
            reason: 'recognised orders ÷ recognised customers',
          }),
          averageCustomerOrderValue: this.money(metrics.averageCustomerOrderValue, base),
        },
        clr: {
          total: this.money(metrics.cumulativeClr, {
            dateBasis: 'observed cumulative over recognised orders',
            empty,
          }),
          statement: CLR_STATEMENT,
        },
        unattributed: {
          orders: metrics.unattributed.orders,
          customers: metrics.unattributed.customers,
          revenue: metrics.unattributed.revenue,
          statement: UNATTRIBUTED_STATEMENT,
        },
      },
      ctx,
      metrics,
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Acquisition-month × retention × cumulative CLR (financial — revenue shown). */
  async getCohorts(query: CustomersQueryDto) {
    const key = analyticsCacheKey('customers/cohorts', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const raw = await this.fetchCandidates(ctx);
    const candidates = this.applyCustomerSegment(raw, ctx);
    const result = computeCohorts({ range: ctx.range, orders: candidates });
    const metrics = computeCustomerMetrics({ range: ctx.range, orders: candidates });
    const response = this.respond(
      result.state === 'ok'
        ? {
            state: 'ok' as const,
            months: result.months,
            cohorts: result.cohorts,
            insufficientReason: null,
          }
        : {
            state: COHORT_INSUFFICIENT_HISTORY as 'insufficient_history',
            months: result.months,
            cohorts: [],
            insufficientReason: result.reason,
          },
      ctx,
      metrics,
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Paginated customer rows for the §4.2 drill (financial — revenue shown). */
  async getCustomers(query: CustomersQueryDto) {
    const key = analyticsCacheKey('customers/list', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const raw = await this.fetchCandidates(ctx);
    const candidates = this.applyCustomerSegment(raw, ctx);
    const metrics = computeCustomerMetrics({ range: ctx.range, orders: candidates });
    const segmentFilter = (query as { segment?: string }).segment as
      | CustomerSegmentLabel
      | undefined;
    const rows = this.rowsFrom(metrics, ctx.range, this.profileOf(raw)).filter(
      (r) => !segmentFilter || r.segment === segmentFilter,
    );
    const { page, pageSize } = customersPagination(query);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    const response = this.respond(
      {
        rows: slice,
        total: rows.length,
        page,
        pageSize,
        totalPages,
        unattributed: {
          orders: metrics.unattributed.orders,
          customers: metrics.unattributed.customers,
          revenue: metrics.unattributed.revenue,
          statement: UNATTRIBUTED_STATEMENT,
        },
      },
      ctx,
      metrics,
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }
}
