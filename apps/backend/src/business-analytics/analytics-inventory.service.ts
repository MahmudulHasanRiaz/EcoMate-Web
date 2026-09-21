/**
 * Business analytics inventory service (P8, §2.8 + §4.2 inventory rows).
 *
 * Value at date t is RECONSTRUCTED from CostingLot history:
 *   Σ over lots (receivedAt ≤ t) of (quantity − consumedBy(t)) × unitCost
 *   consumedBy(t) = Σ Consumption qty (createdAt ≤ t)
 *                 − Σ Restoration qty (createdAt ≤ t)
 *
 * Lot math is wrapped, never forked: the CLOSING value is delegated to the
 * canonical InventoryService.valuation() (FIFO, current state). The
 * reconstruction is cross-checked against it (unscoped totals); divergence
 * means incomplete history ⇒ basis 'closing_only' is disclosed and the
 * opening / average / turnover chain goes unavailable rather than invented.
 *
 * Turnover uses COGS(period) from the P2 recognised cohort (Delivered-only,
 * net of return-event reversals — the same cohort as the ladder).
 * Movement classes reuse the P1 classifyMovement contract verbatim.
 * Stock-out days come from PhysicalInventoryLedger / ManagedStockLedger
 * day-end stock (≤ 0). Lost sales are reported ONLY when a stock-out day
 * exists AND demand is measurable (recognised sales in period); otherwise
 * the line is unavailable — never zero-filled.
 *
 * value/* is financial (FULL perms); movement / stockouts / ledger are
 * general view_analytics (ledger carries quantities only, never unitCost).
 * Cache TTL is 60s for live ranges / 15min for closed ranges via
 * analyticsCacheTtlMs, like every sibling service — with an explicit
 * reconstructedAt on every payload.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  resolveRevenueEvent,
  resolveReturn,
  classifyMovement,
  computeDOI,
  MOVEMENT_FAST_DOI_MAX,
  MOVEMENT_SLOW_DOI_MIN,
  MOVEMENT_RATIONALE,
  type MovementClass,
} from './metric-contract';
import { dhakaDayKey } from '../common/utils/dhaka-time';
import { AnalyticsFilterService } from './analytics-filter.service';
import type { InventoryQueryDto } from './analytics-inventory.dto';
import { inventoryPagination } from './analytics-inventory.dto';
import type { ResolvedAnalyticsContext } from './analytics-filter.service';
import {
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  kpiOk,
  kpiZero,
  kpiNoData,
  kpiUnavailable,
  kpiEstimated,
  type KpiValue,
  type AnalyticsMeta,
} from './analytics-envelope.util';

// ---------------------------------------------------------------------------
// Verbatim disclosure strings (mirrored by the admin inventory page).
// ---------------------------------------------------------------------------

/** §2.8 reconstruction formula — stated on the value panel. */
export const INVENTORY_VALUE_BASIS_STATEMENT =
  'Inventory Value is reconstructed from CostingLot history: ' +
  'Σ over lots received on or before the valuation date of ' +
  '(quantity − consumed + restored) × unitCost.';

/** §8-style fallback — incomplete history is disclosed, never papered over. */
export const INVENTORY_CLOSING_ONLY_NOTE =
  'Lot history is incomplete — value is shown on a closing-only basis from ' +
  'the current FIFO valuation. Opening, average, turnover and days of ' +
  'inventory are unavailable.';

/** §2.8 movement policy label — movement is a default policy, not truth. */
export const MOVEMENT_POLICY_LABEL =
  'classified by our default 30/90-day policy';

/** Lost-sales honesty — stock-out plus measurable demand, else unavailable. */
export const LOST_SALES_NOTE =
  'Lost sales are reported only for days with stock ≤ 0 where demand is ' +
  'measurable (recognised sales in the period); otherwise unavailable — ' +
  'never zero-filled.';

/** §4.2 drill path for the inventory page. */
export const INVENTORY_DRILL_LABEL =
  'Inventory value → movement class → product/variant → stock ledger';

// ---------------------------------------------------------------------------
// Pure reconstruction math (unit-tested, no DB).
// ---------------------------------------------------------------------------

export interface LotEventInput {
  quantity: number;
  createdAt: Date;
}

export interface LotHistoryInput {
  quantity: number;
  unitCost: number;
  receivedAt: Date;
  consumptions: LotEventInput[];
  restorations: LotEventInput[];
}

export interface ReconstructedValue {
  value: number;
  units: number;
  lots: number;
}

/** consumedBy(t) = Σ consumption qty (≤ t) − Σ restoration qty (≤ t). */
export function consumedByAt(
  input: Pick<LotHistoryInput, 'consumptions' | 'restorations'>,
  t: Date,
): number {
  const consumed = input.consumptions
    .filter((c) => c.createdAt <= t)
    .reduce((s, c) => s + c.quantity, 0);
  const restored = input.restorations
    .filter((r) => r.createdAt <= t)
    .reduce((s, r) => s + r.quantity, 0);
  return consumed - restored;
}

/** Σ over lots (receivedAt ≤ t) of max(0, quantity − consumedBy(t)) × unitCost. */
export function reconstructValueAt(
  lots: LotHistoryInput[],
  t: Date,
): ReconstructedValue {
  let value = 0;
  let units = 0;
  let count = 0;
  for (const lot of lots) {
    if (lot.receivedAt > t) continue;
    const remaining = Math.max(0, lot.quantity - consumedByAt(lot, t));
    value += remaining * lot.unitCost;
    units += remaining;
    count += 1;
  }
  return { value, units, lots: count };
}

export type InventoryValueBasis = 'reconstructed' | 'closing_only';

export interface BasisReconciliation {
  basis: InventoryValueBasis;
  reason?: string;
}

/** Relative tolerance for the reconstruction-vs-delegated cross-check. */
export const RECONCILIATION_TOLERANCE = 0.005;

/**
 * Cross-check the reconstructed close against the delegated FIFO close.
 * Agreement ⇒ reconstructed; divergence ⇒ closing_only with the cause.
 */
export function reconcileInventoryBasis(
  reconstructedClose: number,
  delegatedClose: number,
): BasisReconciliation {
  const scale = Math.max(1, Math.abs(delegatedClose));
  if (Math.abs(reconstructedClose - delegatedClose) / scale <= RECONCILIATION_TOLERANCE) {
    return { basis: 'reconstructed' };
  }
  return {
    basis: 'closing_only',
    reason:
      `reconstructed close (৳${reconstructedClose}) diverges from the FIFO ` +
      `valuation (৳${delegatedClose}) — lot history is incomplete`,
  };
}

/** Average Inventory Value = (opening + closing) / 2. */
export function computeAverageInventory(opening: number, closing: number): number {
  return (opening + closing) / 2;
}

/** Stock Turnover = COGS(period) / Average. Null when average ≤ 0 (never 0/∞). */
export function computeTurnover(cogs: number, average: number): number | null {
  if (!Number.isFinite(cogs) || !Number.isFinite(average) || average <= 0) return null;
  return cogs / average;
}

/** Days of Inventory = periodDays / Turnover. Null without turnover. */
export function computeInventoryDOI(
  turnover: number | null,
  periodDays: number,
): number | null {
  if (turnover === null || !Number.isFinite(turnover) || turnover <= 0) return null;
  return periodDays / turnover;
}

/** Sell-through = unitsSold / (unitsSold + closingUnits). Null when empty. */
export function computeSellThrough(
  unitsSold: number,
  closingUnits: number,
): number | null {
  const denom = unitsSold + closingUnits;
  if (!Number.isFinite(denom) || denom <= 0) return null;
  return unitsSold / denom;
}

/** Stock-out frequency = days with day-end stock ≤ 0. */
export function computeStockoutDays(dailyClosingStock: number[]): number {
  return dailyClosingStock.filter((s) => s <= 0).length;
}

export interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  units: number;
  value: number;
}

const MS_PER_DAY = 24 * 3600 * 1000;

/** Age buckets of the RECONSTRUCTED remainder (never the received qty). */
export function computeAging(lots: LotHistoryInput[], t: Date): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: '0–30', minDays: 0, maxDays: 30, units: 0, value: 0 },
    { label: '31–60', minDays: 31, maxDays: 60, units: 0, value: 0 },
    { label: '61–90', minDays: 61, maxDays: 90, units: 0, value: 0 },
    { label: '90+', minDays: 91, maxDays: null, units: 0, value: 0 },
  ];
  for (const lot of lots) {
    if (lot.receivedAt > t) continue;
    const remaining = Math.max(0, lot.quantity - consumedByAt(lot, t));
    if (remaining <= 0) continue;
    const ageDays = Math.max(
      0,
      Math.floor((t.getTime() - lot.receivedAt.getTime()) / MS_PER_DAY),
    );
    const bucket =
      buckets.find((b) => ageDays >= b.minDays && (b.maxDays === null || ageDays <= b.maxDays)) ??
      buckets[buckets.length - 1];
    bucket.units += remaining;
    bucket.value += remaining * lot.unitCost;
  }
  return buckets;
}

export interface LostSalesInput {
  stockoutDays: number;
  unitsSold: number;
  periodDays: number;
  avgUnitCost: number;
}

export interface LostSalesResult {
  state: 'estimated' | 'unavailable';
  lostUnits: number | null;
  lostValue: number | null;
  reason: string;
}

/**
 * Lost sales only when a stock-out day exists AND demand is measurable
 * (recognised sales in period evidence demand). Estimate = daily sales rate
 * × stock-out days × average unit cost. Otherwise unavailable — never zero.
 */
export function computeLostSales(input: LostSalesInput): LostSalesResult {
  if (input.stockoutDays <= 0) {
    return {
      state: 'unavailable',
      lostUnits: null,
      lostValue: null,
      reason: 'no stock-out days in range — no measurable lost sales',
    };
  }
  if (input.unitsSold <= 0) {
    return {
      state: 'unavailable',
      lostUnits: null,
      lostValue: null,
      reason:
        'demand not measurable — no recognised sales in the period to evidence demand',
    };
  }
  const lostUnits = (input.unitsSold / input.periodDays) * input.stockoutDays;
  return {
    state: 'estimated',
    lostUnits,
    lostValue: lostUnits * input.avgUnitCost,
    reason: `daily sales rate × ${input.stockoutDays} stock-out day(s) × avg unit cost`,
  };
}

/** Movement class label with the default-policy qualifier for the UI. */
export function movementPolicyLabel(movementClass: MovementClass): string {
  return `${movementClass} — ${MOVEMENT_POLICY_LABEL}`;
}

// ---------------------------------------------------------------------------
// Response shapes.
// ---------------------------------------------------------------------------

export interface InventoryValueData {
  periodDays: number;
  reconstructedAt: string;
  basis: InventoryValueBasis;
  basisNote: string;
  basisStatement: string;
  value: { opening: KpiValue; closing: KpiValue; average: KpiValue };
  turnover: KpiValue;
  doi: KpiValue;
  cogs: { amount: number; dateBasis: string };
  aging: { buckets: AgingBucket[]; dateBasis: string };
  coverage: { lots: number; products: number; inactiveExcluded: number };
}

export interface InventoryMovementRow {
  productId: string;
  variantId: string | null;
  name: string;
  unitsSold: number;
  closingUnits: number;
  doi: number | null;
  movementClass: MovementClass;
  policyLabel: string;
  sellThrough: number | null;
  stockoutDays: number;
}

export interface InventoryMovementData {
  periodDays: number;
  reconstructedAt: string;
  policyLabel: string;
  policyRationale: string;
  rows: InventoryMovementRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InventoryStockoutRow {
  productId: string;
  variantId: string | null;
  name: string;
  stockoutDays: number;
  coveredDays: number;
}

export interface InventoryStockoutsData {
  periodDays: number;
  reconstructedAt: string;
  stockoutDays: KpiValue;
  productsAffected: number;
  lostSales: KpiValue & { lostUnits?: number | null };
  lostSalesNote: string;
  rows: InventoryStockoutRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InventoryLedgerRow {
  id: string;
  source: 'physical' | 'managed';
  productId: string | null;
  variantId: string | null;
  warehouseId: string | null;
  quantity: number;
  direction: string | null;
  stockBefore: number | null;
  stockAfter: number | null;
  type: string | null;
  reason: string | null;
  createdAt: string;
}

export interface InventoryLedgerData {
  periodDays: number;
  rows: InventoryLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  dateBasis: string;
}

const DATE_BASIS_VALUE = 'CostingLot receivedAt ≤ valuation date; consumptions − restorations by createdAt (FIFO history)';
const DATE_BASIS_COHORT = 'Delivered transition — the P&L cohort (net of return-event reversals)';
const DATE_BASIS_LEDGER = 'Ledger entry date (createdAt / performedAt), Dhaka day-end stock';

@Injectable()
export class AnalyticsInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly cache: CacheService,
    private readonly inventoryService: InventoryService,
  ) {}

  private respond<T>(
    data: T,
    ctx: ResolvedAnalyticsContext,
    coverage: Record<string, unknown>,
  ): { data: T; meta: AnalyticsMeta } {
    return {
      data,
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: { inventory: coverage },
        ladderState: 'actual',
        thresholds: {
          movementFastDoiMax: MOVEMENT_FAST_DOI_MAX,
          movementSlowDoiMin: MOVEMENT_SLOW_DOI_MIN,
          movementRationale: MOVEMENT_RATIONALE,
        },
        dateBasis:
          'Value CostingLot history; turnover COGS Delivered cohort; ' +
          'movement unit-DOI; stock-out ledger day-end (Dhaka)',
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
   * Product ids of the delegated valuation() cohort — mirrors
   * InventoryService.valuation() scoping (active products, categoryId exact
   * match, search over name/sku case-insensitive) so a filtered page
   * reconstructs the same cohort the closing value is delegated for.
   * Agreement — never a forced closing_only.
   */
  private async resolveValuationProductIds(filters: {
    categoryId?: string;
    search?: string;
  }): Promise<string[]> {
    const and: any[] = [{ isActive: true }];
    if (filters.categoryId) and.push({ categoryId: filters.categoryId });
    if (filters.search) {
      and.push({
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { sku: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
    }
    const rows: any[] = await this.prisma.product.findMany({
      where: { AND: and },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ── scoped lot history (active products; FIFO consumptions + restorations)
  private async fetchLots(ctx: ResolvedAnalyticsContext): Promise<{
    lots: (LotHistoryInput & { productId: string; variantId: string | null; warehouseId: string })[];
    inactiveExcluded: number;
  }> {
    const { filters } = ctx;
    const search = (filters as InventoryQueryDto).search;
    const where: any = {};
    if (filters.warehouseId) where.warehouseId = filters.warehouseId;
    if (filters.productId) where.productId = filters.productId;
    if (filters.variantId !== undefined) where.variantId = filters.variantId ?? null;
    if (filters.categoryId || search) {
      const scopedIds = await this.resolveValuationProductIds({
        categoryId: filters.categoryId,
        search,
      });
      if (where.productId !== undefined) {
        // Product narrow ∩ valuation cohort — outside the cohort ⇒ no lots.
        if (!scopedIds.includes(where.productId)) return { lots: [], inactiveExcluded: 0 };
      } else {
        where.productId = { in: scopedIds };
      }
    }
    const rows: any[] = await this.prisma.costingLot.findMany({
      where,
      select: {
        quantity: true,
        unitCost: true,
        receivedAt: true,
        productId: true,
        variantId: true,
        warehouseId: true,
        consumptions: {
          select: {
            quantity: true,
            createdAt: true,
            restorations: { select: { quantity: true, createdAt: true } },
          },
        },
      },
    });
    // CostingLot carries no product relation — resolve isActive separately.
    // Inactive products are excluded to match the delegated FIFO valuation.
    const activeById = new Map<string, boolean>();
    const ids = [...new Set(rows.map((r) => r.productId))];
    if (ids.length > 0) {
      const products: any[] = await this.prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, isActive: true },
      });
      for (const p of products) activeById.set(p.id, p.isActive !== false);
    }
    let inactiveExcluded = 0;
    const lots: (LotHistoryInput & { productId: string; variantId: string | null; warehouseId: string })[] = [];
    for (const r of rows) {
      if (activeById.get(r.productId) === false) {
        inactiveExcluded += 1;
        continue;
      }
      const restorations: LotEventInput[] = [];
      for (const c of r.consumptions ?? []) {
        for (const restoration of c.restorations ?? []) {
          restorations.push({
            quantity: restoration.quantity,
            createdAt: new Date(restoration.createdAt),
          });
        }
      }
      lots.push({
        quantity: r.quantity,
        unitCost: Number(r.unitCost),
        receivedAt: new Date(r.receivedAt),
        consumptions: (r.consumptions ?? []).map((c: any) => ({
          quantity: c.quantity,
          createdAt: new Date(c.createdAt),
        })),
        restorations,
        productId: r.productId,
        variantId: r.variantId ?? null,
        warehouseId: r.warehouseId,
      });
    }
    return { lots, inactiveExcluded };
  }

  /**
   * P2 recognised cohort, inventory-scoped: per-key units sold + COGS net of
   * return-event reversals. Mirrors the ladder cohort (Delivered-only) without
   * redefining it — resolveRevenueEvent / resolveReturn are the P1 contract.
   */
  private async fetchCohort(ctx: ResolvedAnalyticsContext): Promise<{
    cogs: number;
    unitsByKey: Map<string, { productId: string; variantId: string | null; units: number; cogs: number }>;
    recognisedOrders: number;
  }> {
    const { range, filters } = ctx;
    const marketingOrderIds = filters.marketingSource
      ? await this.filters.resolveMarketingOrderIds(filters.marketingSource)
      : undefined;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    const orders: any[] = await this.prisma.order.findMany({
      where: { ...where, createdAt: { lte: range.end } },
      select: {
        id: true,
        status: { select: { name: true } },
        timeline: true,
        dispatches: { select: { deliveredAt: true }, orderBy: { deliveredAt: 'desc' } },
        items: {
          select: {
            productId: true,
            variantId: true,
            sourceWarehouseId: true,
            quantity: true,
            costSnapshot: true,
          },
        },
      },
    });

    let productCategory = new Map<string, string | null>();
    if (filters.categoryId) {
      const ids = [...new Set(orders.flatMap((o) => (o.items ?? []).map((i: any) => i.productId)))];
      if (ids.length > 0) {
        const products: any[] = await this.prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, categoryId: true },
        });
        productCategory = new Map(products.map((p) => [p.id, p.categoryId ?? null]));
      }
    }

    let cogs = 0;
    let recognisedOrders = 0;
    const unitsByKey = new Map<string, { productId: string; variantId: string | null; units: number; cogs: number }>();
    const inRange = (d: Date | null): d is Date =>
      d !== null && d >= range.start && d <= range.end;
    for (const o of orders) {
      const deliveredAts = (o.dispatches ?? [])
        .map((d: any) => d.deliveredAt)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      const rev = resolveRevenueEvent({
        timeline: Array.isArray(o.timeline) ? o.timeline : [],
        dispatchDeliveredAt:
          deliveredAts.length > 0
            ? new Date(Math.max(...deliveredAts.map((d: Date) => d.getTime())))
            : null,
        currentStatus: o.status?.name ?? '',
      });
      // Delivered-then-returned: recognition at delivery, reversal at the
      // return event (D4 cross-period — P2 never rewrites the delivery period).
      const ret = resolveReturn(
        Array.isArray(o.timeline) ? o.timeline : [],
        rev.revenueDate,
      );
      const recognisedInRange = rev.recognised && inRange(rev.revenueDate);
      const returnInRange =
        ret.reversesRevenue && ret.returnAt !== null && inRange(ret.returnAt);
      if (!recognisedInRange && !returnInRange) continue;
      if (recognisedInRange) recognisedOrders += 1;
      for (const item of o.items ?? []) {
        if (filters.warehouseId && item.sourceWarehouseId !== filters.warehouseId) continue;
        if (filters.productId && item.productId !== filters.productId) continue;
        if (filters.variantId !== undefined && (item.variantId ?? null) !== (filters.variantId ?? null)) continue;
        if (filters.categoryId && productCategory.get(item.productId) !== filters.categoryId) continue;
        const lineCost = item.costSnapshot === null || item.costSnapshot === undefined
          ? 0
          : Number(item.costSnapshot) * item.quantity;
        if (recognisedInRange) cogs += lineCost;
        if (returnInRange) cogs -= lineCost;
        if (!recognisedInRange) continue;
        const key = `${item.productId}|${item.variantId ?? ''}`;
        const cur = unitsByKey.get(key) ?? { productId: item.productId, variantId: item.variantId ?? null, units: 0, cogs: 0 };
        cur.units += item.quantity;
        cur.cogs += lineCost;
        unitsByKey.set(key, cur);
      }
    }
    return { cogs, unitsByKey, recognisedOrders };
  }

  /** Day-end stock series per product key from both ledgers (Dhaka days). */
  private async fetchLedgerSeries(
    ctx: ResolvedAnalyticsContext,
  ): Promise<Map<string, { productId: string; variantId: string | null; days: { key: string; stock: number }[] }>> {
    const { range, filters } = ctx;
    const productWhere: any = {};
    if (filters.productId) productWhere.productId = filters.productId;
    if (filters.variantId !== undefined) productWhere.variantId = filters.variantId ?? null;
    if (filters.warehouseId) productWhere.warehouseId = filters.warehouseId;
    const [physical, managed] = await Promise.all([
      this.prisma.physicalInventoryLedger.findMany({
        where: { ...productWhere, createdAt: { gte: range.start, lte: range.end } },
        select: {
          productId: true,
          variantId: true,
          stockAfter: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.managedStockLedger.findMany({
        where: {
          ...(filters.productId ? { productId: filters.productId } : {}),
          ...(filters.variantId !== undefined ? { variantId: filters.variantId ?? null } : {}),
          performedAt: { gte: range.start, lte: range.end },
        },
        select: {
          productId: true,
          variantId: true,
          stockAfter: true,
          performedAt: true,
        },
        orderBy: { performedAt: 'asc' },
      }),
    ]);
    type Entry = { at: Date; stock: number };
    const byKey = new Map<string, { productId: string; variantId: string | null; entries: Entry[] }>();
    const push = (productId: string | null, variantId: string | null, at: Date, stock: number | null) => {
      if (!productId || stock === null || stock === undefined) return;
      const key = `${productId}|${variantId ?? ''}`;
      const cur = byKey.get(key) ?? { productId, variantId: variantId ?? null, entries: [] };
      cur.entries.push({ at, stock });
      byKey.set(key, cur);
    };
    for (const e of physical as any[]) push(e.productId, e.variantId ?? null, new Date(e.createdAt), e.stockAfter);
    for (const e of managed as any[]) push(e.productId, e.variantId ?? null, new Date(e.performedAt), e.stockAfter);

    // Day-end = last entry per Dhaka day; carry forward across empty days
    // AFTER the first observed day; days before the first entry are unknown
    // and excluded (disclosed via coveredDays).
    const out = new Map<string, { productId: string; variantId: string | null; days: { key: string; stock: number }[] }>();
    for (const [key, v] of byKey) {
      const sorted = [...v.entries].sort((a, b) => a.at.getTime() - b.at.getTime());
      const dayEnd = new Map<string, number>();
      for (const e of sorted) dayEnd.set(dhakaDayKey(e.at), e.stock);
      const orderedKeys = [...dayEnd.keys()].sort();
      const days: { key: string; stock: number }[] = [];
      let prev: number | null = null;
      let cursor = orderedKeys[0];
      const lastKey = orderedKeys[orderedKeys.length - 1];
      while (cursor <= lastKey) {
        if (dayEnd.has(cursor)) prev = dayEnd.get(cursor) as number;
        if (prev !== null) days.push({ key: cursor, stock: prev });
        cursor = nextDhakaDayKey(cursor);
      }
      out.set(key, { productId: v.productId, variantId: v.variantId, days });
    }
    return out;
  }

  private scopedValueQuery(query: InventoryQueryDto): { scoped: boolean; params: Record<string, string> } {
    const scoped = Boolean(query.warehouseId ?? query.productId ?? query.variantId);
    const params: Record<string, string> = {};
    if (query.categoryId) params.categoryId = query.categoryId;
    if (query.search) params.search = query.search;
    return { scoped, params };
  }

  /** Inventory value: delegated close + reconstructed open + turnover (financial). */
  async getValue(query: InventoryQueryDto) {
    const key = analyticsCacheKey('inventory/value', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const reconstructedAt = new Date().toISOString();

    const [{ lots, inactiveExcluded }, cohort] = await Promise.all([
      this.fetchLots(ctx),
      this.fetchCohort(ctx),
    ]);
    const open = reconstructValueAt(lots, new Date(range.start.getTime() - 1));
    const reconstructedClose = reconstructValueAt(lots, range.end);
    const { scoped, params } = this.scopedValueQuery(query);

    // The closing value is DELEGATED to the canonical FIFO valuation —
    // never recomputed here. Scoped pages reconstruct from scoped lots.
    let closingValue: number;
    let basis: InventoryValueBasis;
    let basisReason: string | undefined;
    if (!scoped) {
      const delegated = await this.inventoryService.valuation(params);
      closingValue = Number(delegated.totalValue);
      const check = reconcileInventoryBasis(reconstructedClose.value, closingValue);
      basis = check.basis;
      basisReason = check.reason;
    } else {
      closingValue = reconstructedClose.value;
      basis = 'reconstructed';
    }

    const complete = basis === 'reconstructed';
    const average = complete ? computeAverageInventory(open.value, closingValue) : null;
    const turnover = complete && average !== null ? computeTurnover(cohort.cogs, average) : null;
    const doi = complete ? computeInventoryDOI(turnover, range.periodDays) : null;

    const money = (v: number | null, empty: string): KpiValue =>
      v === null
        ? kpiUnavailable(empty)
        : v === 0
          ? kpiZero('measured zero')
          : kpiOk(v, { dateBasis: DATE_BASIS_VALUE });
    const ratio = (v: number | null, empty: string): KpiValue =>
      v === null
        ? kpiUnavailable(empty)
        : kpiOk(v, { dateBasis: complete ? DATE_BASIS_COHORT : DATE_BASIS_VALUE });

    const data: InventoryValueData = {
      periodDays: range.periodDays,
      reconstructedAt,
      basis,
      basisNote: complete ? INVENTORY_VALUE_BASIS_STATEMENT : INVENTORY_CLOSING_ONLY_NOTE,
      basisStatement: INVENTORY_VALUE_BASIS_STATEMENT,
      value: {
        opening: complete ? money(open.value, 'no lots received before the range') : kpiUnavailable(INVENTORY_CLOSING_ONLY_NOTE),
        closing: money(closingValue, 'no lots on hand'),
        average: average !== null ? money(average, 'measured zero') : kpiUnavailable(INVENTORY_CLOSING_ONLY_NOTE),
      },
      turnover: ratio(turnover, `${basisReason ?? 'average unavailable'} — turnover withheld`),
      doi: ratio(doi, `${basisReason ?? 'turnover unavailable'} — days of inventory withheld`),
      cogs: { amount: cohort.cogs, dateBasis: DATE_BASIS_COHORT },
      aging: { buckets: computeAging(lots, range.end), dateBasis: DATE_BASIS_VALUE },
      coverage: {
        lots: lots.length,
        products: new Set(lots.map((l) => l.productId)).size,
        inactiveExcluded,
      },
    };
    if (!complete && basisReason) {
      (data.turnover as KpiValue).reason = basisReason;
      (data.doi as KpiValue).reason = basisReason;
    }
    const response = this.respond(data, ctx, {
      basis,
      lots: lots.length,
      recognisedOrders: cohort.recognisedOrders,
      cogs: cohort.cogs,
    });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Movement classes per product/variant + default-policy label (general). */
  async getMovement(query: InventoryQueryDto) {
    const key = analyticsCacheKey('inventory/movement', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const { page, pageSize } = inventoryPagination(query);
    const reconstructedAt = new Date().toISOString();

    const [{ lots }, cohort, series] = await Promise.all([
      this.fetchLots(ctx),
      this.fetchCohort(ctx),
      this.fetchLedgerSeries(ctx),
    ]);

    const closingByKey = new Map<string, number>();
    for (const l of lots) {
      const remaining = Math.max(0, l.quantity - consumedByAt(l, range.end));
      const k = `${l.productId}|${l.variantId ?? ''}`;
      closingByKey.set(k, (closingByKey.get(k) ?? 0) + remaining);
    }
    const keys = new Set<string>([...closingByKey.keys(), ...cohort.unitsByKey.keys(), ...series.keys()]);
    const productIds = [...new Set([...keys].map((k) => k.split('|')[0]))];
    const names = new Map<string, string>();
    if (productIds.length > 0) {
      const products: any[] = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true },
      });
      for (const p of products) names.set(p.id, p.name);
    }

    let rows: InventoryMovementRow[] = [...keys].map((k) => {
      const [productId, variantPart] = k.split('|');
      const variantId = variantPart === '' ? null : variantPart;
      const sold = cohort.unitsByKey.get(k);
      const unitsSold = sold?.units ?? 0;
      const closingUnits = closingByKey.get(k) ?? 0;
      const doi = unitsSold > 0 ? computeDOI({ unitsSold, closingStock: closingUnits, periodDays: range.periodDays }) : null;
      const movementClass = classifyMovement({
        unitsSold,
        closingStock: closingUnits,
        ...(doi === null ? {} : { doi }),
        periodDays: range.periodDays,
      });
      const days = series.get(k)?.days ?? [];
      return {
        productId,
        variantId,
        name: names.get(productId) ?? productId,
        unitsSold,
        closingUnits,
        doi,
        movementClass,
        policyLabel: movementPolicyLabel(movementClass),
        sellThrough: computeSellThrough(unitsSold, closingUnits),
        stockoutDays: computeStockoutDays(days.map((d) => d.stock)),
      };
    });

    if (query.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }
    const sort = query.sort ?? 'unitsSold';
    const dir = query.dir === 'asc' ? 1 : -1;
    const pick = (r: InventoryMovementRow): number => {
      switch (sort) {
        case 'doi': return r.doi ?? Number.POSITIVE_INFINITY;
        case 'sellThrough': return r.sellThrough ?? -1;
        case 'stockoutDays': return r.stockoutDays;
        case 'unitsSold': return r.unitsSold;
        default: return r.closingUnits;
      }
    };
    rows.sort((a, b) => (pick(a) - pick(b)) * dir);

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data: InventoryMovementData = {
      periodDays: range.periodDays,
      reconstructedAt,
      policyLabel: MOVEMENT_POLICY_LABEL,
      policyRationale: MOVEMENT_RATIONALE,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
      totalPages,
    };
    const response = this.respond(data, ctx, { rows: total });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Stock-out frequency + lost-sales honesty (general). */
  async getStockouts(query: InventoryQueryDto) {
    const key = analyticsCacheKey('inventory/stockouts', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const { page, pageSize } = inventoryPagination(query);
    const reconstructedAt = new Date().toISOString();

    const [{ lots }, cohort, series] = await Promise.all([
      this.fetchLots(ctx),
      this.fetchCohort(ctx),
      this.fetchLedgerSeries(ctx),
    ]);

    const keys = new Set<string>([...series.keys(), ...cohort.unitsByKey.keys()]);
    const productIds = [...new Set([...keys].map((k) => k.split('|')[0]))];
    const names = new Map<string, string>();
    if (productIds.length > 0) {
      const products: any[] = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true },
      });
      for (const p of products) names.set(p.id, p.name);
    }

    let rows: InventoryStockoutRow[] = [...keys].map((k) => {
      const [productId, variantPart] = k.split('|');
      const days = series.get(k)?.days ?? [];
      return {
        productId,
        variantId: variantPart === '' ? null : variantPart,
        name: names.get(productId) ?? productId,
        stockoutDays: computeStockoutDays(days.map((d) => d.stock)),
        coveredDays: days.length,
      };
    });
    if (query.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }
    rows.sort((a, b) => b.stockoutDays - a.stockoutDays);

    const stockoutDays = rows.reduce((s, r) => s + r.stockoutDays, 0);
    const productsAffected = rows.filter((r) => r.stockoutDays > 0).length;
    const unitsSold = [...cohort.unitsByKey.values()].reduce((s, v) => s + v.units, 0);
    const closingValue = reconstructValueAt(lots, range.end);
    const avgUnitCost = closingValue.units > 0 ? closingValue.value / closingValue.units : 0;
    const lost = computeLostSales({
      stockoutDays,
      unitsSold,
      periodDays: range.periodDays,
      avgUnitCost,
    });
    const lostSales: InventoryStockoutsData['lostSales'] =
      lost.state === 'estimated'
        ? { ...kpiEstimated(lost.lostValue as number, lost.reason), lostUnits: lost.lostUnits }
        : { ...kpiUnavailable(lost.reason), lostUnits: null };

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data: InventoryStockoutsData = {
      periodDays: range.periodDays,
      reconstructedAt,
      stockoutDays:
        rows.length === 0
          ? kpiNoData('no ledger coverage in range')
          : stockoutDays === 0
            ? kpiZero('no day closed at stock ≤ 0')
            : kpiOk(stockoutDays, { dateBasis: DATE_BASIS_LEDGER }),
      productsAffected,
      lostSales,
      lostSalesNote: LOST_SALES_NOTE,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
      totalPages,
    };
    const response = this.respond(data, ctx, { stockoutDays, productsAffected });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Stock ledger drill-down: quantities only, never unitCost (general). */
  async getLedger(query: InventoryQueryDto) {
    const key = analyticsCacheKey('inventory/ledger', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const { page, pageSize } = inventoryPagination(query);

    const productWhere: any = {};
    if (query.productId) productWhere.productId = query.productId;
    if (query.variantId !== undefined) productWhere.variantId = query.variantId ?? null;
    if (query.warehouseId) productWhere.warehouseId = query.warehouseId;

    const [physical, managed] = await Promise.all([
      this.prisma.physicalInventoryLedger.findMany({
        where: { ...productWhere, createdAt: { gte: range.start, lte: range.end } },
        select: {
          id: true,
          productId: true,
          variantId: true,
          warehouseId: true,
          quantity: true,
          direction: true,
          stockBefore: true,
          stockAfter: true,
          type: true,
          reason: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.managedStockLedger.findMany({
        where: {
          ...(query.productId ? { productId: query.productId } : {}),
          ...(query.variantId !== undefined ? { variantId: query.variantId ?? null } : {}),
          performedAt: { gte: range.start, lte: range.end },
        },
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          direction: true,
          stockBefore: true,
          stockAfter: true,
          type: true,
          reason: true,
          performedAt: true,
        },
        orderBy: { performedAt: 'desc' },
      }),
    ]);

    const rows: InventoryLedgerRow[] = [
      ...(physical as any[]).map((e) => ({
        id: e.id,
        source: 'physical' as const,
        productId: e.productId,
        variantId: e.variantId ?? null,
        warehouseId: e.warehouseId ?? null,
        quantity: e.quantity,
        direction: e.direction ?? null,
        stockBefore: e.stockBefore ?? null,
        stockAfter: e.stockAfter ?? null,
        type: e.type ?? null,
        reason: e.reason ?? null,
        createdAt: new Date(e.createdAt).toISOString(),
      })),
      ...(managed as any[]).map((e) => ({
        id: e.id,
        source: 'managed' as const,
        productId: e.productId ?? null,
        variantId: e.variantId ?? null,
        warehouseId: null,
        quantity: e.quantity,
        direction: e.direction ?? null,
        stockBefore: e.stockBefore ?? null,
        stockAfter: e.stockAfter ?? null,
        type: e.type ?? null,
        reason: e.reason ?? null,
        createdAt: new Date(e.performedAt).toISOString(),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data: InventoryLedgerData = {
      periodDays: range.periodDays,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
      totalPages,
      dateBasis: DATE_BASIS_LEDGER,
    };
    const response = this.respond(data, ctx, { entries: total });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }
}

/** Next Dhaka calendar day key (YYYY-MM-DD), for ledger carry-forward. */
export function nextDhakaDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + MS_PER_DAY);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}
