/**
 * Business analytics products service (P4, §2.6 product/variant P&L).
 *
 * Delivery-recognised orders ONLY (D4 — the same resolveRevenueEvent gate as
 * the ladder, never duplicated). Per-line basis labels:
 *   Gross/Discounts/Returns/Net/Units/COGS … direct (own lines)
 *   Marketing Cost … attributed (ProductMarketingCost per orderItemId)
 *   Fulfillment/Gateway … allocated (order totals × lineNet ÷ orderNet)
 *   Operating Expenses … NOT allocated (company-level only)
 * Bottom line = Contribution Profit/Margin. Refunds are order-level and are
 * never allocated to products (limitation 3) — R1 therefore holds up to the
 * disclosed reversal gap.
 *
 * Combo lines expand to components via OrderItemComboComponent
 * (productId/variantId/totalQuantity, quantity-share split); the combo line
 * itself attributes nothing, so combo lines never double-count. Parent
 * aggregation is ALWAYS derived (parent = Σ children); simple products carry
 * one implicit child (variantId = null). COGS uses costSnapshot only — the
 * current standardCost is never consulted (no back-fill, §2.3). Product /
 * variant return rate is order-level incidence, labelled (F2 — never
 * fractional).
 */
import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  resolveRevenueEvent,
  resolveReturn,
  allocateDiscount,
  computeMargin,
  classifyMovement,
  computeDOI,
  MOVEMENT_RATIONALE,
  type TimelineEntry,
} from './metric-contract';
import {
  AnalyticsFilterService,
  customerKeyOf,
  deriveCustomerSegments,
  type ResolvedAnalyticsContext,
} from './analytics-filter.service';
import {
  ProductsQueryDto,
  hasProductLineScope,
} from './analytics-products.dto';
import {
  bucketEdges,
  fittingGranularity,
} from './analytics-overview.service';
import {
  kpiOk,
  kpiZero,
  kpiNoData,
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  type KpiValue,
  type AnalyticsMeta,
} from './analytics-envelope.util';

/** Low-margin policy — not a universal truth; surfaced in meta.thresholds. */
export const LOW_CONTRIBUTION_MARGIN = 0.1;
export const LOW_MARGIN_RATIONALE =
  'Default 10% policy: a product whose Contribution Margin is below 10% is flagged low-margin. Not a universal truth — the UI labels the policy.';

export const PRODUCT_CONTRIBUTION_FLOOR_STATEMENT =
  'Product P&L stops at Contribution. Company operating expenses are not allocated to products.';

export const RETURN_INCIDENCE_LABEL =
  'order-level incidence — never fractional';

function inRange(at: Date | null, range: { start: Date; end: Date }): boolean {
  return at !== null && at >= range.start && at <= range.end;
}

// ---------------------------------------------------------------------------
// Pure inputs.
// ---------------------------------------------------------------------------

export interface ProductComponentInput {
  productId: string;
  variantId: string | null;
  totalQuantity: number;
  categoryIds: string[];
}

export interface ProductLineInput {
  orderItemId: string;
  productId: string | null;
  variantId: string | null;
  price: number;
  quantity: number;
  costSnapshot: number | null;
  costType: 'actual' | 'estimated' | null;
  sourceWarehouseId: string | null;
  /** Line product's own categories (primary + secondary) for line scoping. */
  categoryIds: string[];
  comboComponents: ProductComponentInput[];
  /** Σ ProductMarketingCost.marketingCost for this orderItemId (attributed). */
  marketingCost: number;
}

export interface ProductOrderInput {
  id: string;
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
  items: ProductLineInput[];
  payments: { amount: number; status: string; feeAmount?: number | null }[];
}

export interface ProductScope {
  productId?: string;
  variantId?: string;
  categoryId?: string;
  warehouseId?: string;
  productIds?: string[];
}

export interface ProductPnlInput {
  range: { start: Date; end: Date };
  orders: ProductOrderInput[];
  scope?: ProductScope;
}

export interface UncostedLine {
  orderId: string;
  orderItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  lineNet: number;
}

export interface ProductVariantAcc {
  productId: string;
  variantId: string | null;
  gross: number;
  discount: number;
  returns: number;
  cogs: number;
  returnedCogs: number;
  units: number;
  returnedUnits: number;
  marketing: number;
  fulfillment: number;
  fees: number;
  uncostedUnits: number;
  uncostedLines: number;
  missingShippingCost: boolean;
  missingFee: boolean;
  recognisedOrders: string[];
  returnOrders: string[];
}

export interface ProductPnlResult {
  variants: ProductVariantAcc[];
  uncostedLines: UncostedLine[];
  totals: {
    gross: number;
    discount: number;
    returns: number;
    net: number;
    cogs: number;
    returnedCogs: number;
    units: number;
    marketing: number;
    fulfillment: number;
    fees: number;
    contribution: number;
    uncostedUnits: number;
    uncostedLines: number;
  };
}

interface Attribution {
  productId: string;
  variantId: string | null;
  /** Share of the host line (1 for own lines; quantity-share for components). */
  share: number;
  units: number;
  categoryIds: string[];
}

function matchesScope(
  attr: Attribution,
  line: ProductLineInput,
  scope: ProductScope | undefined,
): boolean {
  if (!scope) return true;
  if (scope.productId && attr.productId !== scope.productId) return false;
  if (scope.variantId && attr.variantId !== scope.variantId) return false;
  if (scope.categoryId && !attr.categoryIds.includes(scope.categoryId)) {
    return false;
  }
  if (scope.warehouseId && line.sourceWarehouseId !== scope.warehouseId) {
    return false;
  }
  if (scope.productIds && !scope.productIds.includes(attr.productId)) {
    return false;
  }
  return true;
}

/**
 * Decompose a line into per-(product,variant) attributions. Combo lines
 * expand to components by totalQuantity share; the combo host line itself
 * attributes nothing (never double-counted). Simple/own lines attribute
 * wholly to (productId, variantId — null for simple products).
 */
export function expandLine(line: ProductLineInput): Attribution[] {
  if (line.comboComponents.length > 0) {
    const total = line.comboComponents.reduce(
      (s, c) => s + c.totalQuantity,
      0,
    );
    if (!(total > 0)) return [];
    return line.comboComponents.map((c) => ({
      productId: c.productId,
      variantId: c.variantId,
      share: c.totalQuantity / total,
      units: c.totalQuantity,
      categoryIds: c.categoryIds,
    }));
  }
  if (!line.productId) return [];
  return [
    {
      productId: line.productId,
      variantId: line.variantId,
      share: 1,
      units: line.quantity,
      categoryIds: line.categoryIds,
    },
  ];
}

function newAcc(productId: string, variantId: string | null): ProductVariantAcc {
  return {
    productId,
    variantId,
    gross: 0,
    discount: 0,
    returns: 0,
    cogs: 0,
    returnedCogs: 0,
    units: 0,
    returnedUnits: 0,
    marketing: 0,
    fulfillment: 0,
    fees: 0,
    uncostedUnits: 0,
    uncostedLines: 0,
    missingShippingCost: false,
    missingFee: false,
    recognisedOrders: [],
    returnOrders: [],
  };
}

export function computeProductPnl(input: ProductPnlInput): ProductPnlResult {
  const { range, scope } = input;
  const accs = new Map<string, ProductVariantAcc>();
  const uncostedLines: UncostedLine[] = [];
  const accFor = (productId: string, variantId: string | null) => {
    const key = `${productId}::${variantId ?? ''}`;
    let acc = accs.get(key);
    if (!acc) {
      acc = newAcc(productId, variantId);
      accs.set(key, acc);
    }
    return acc;
  };
  const markOrders = (
    acc: ProductVariantAcc,
    orderId: string,
    isReturn: boolean,
  ) => {
    if (!acc.recognisedOrders.includes(orderId)) {
      acc.recognisedOrders.push(orderId);
    }
    if (isReturn && !acc.returnOrders.includes(orderId)) {
      acc.returnOrders.push(orderId);
    }
  };

  for (const order of input.orders) {
    const rev = resolveRevenueEvent({
      timeline: order.timeline ?? [],
      dispatchDeliveredAt: order.dispatchDeliveredAt ?? null,
      currentStatus: order.status,
    });
    const ret = resolveReturn(order.timeline ?? [], rev.revenueDate);
    const recognisedEver = rev.recognised;
    const inCohort = recognisedEver && inRange(rev.revenueDate, range);

    // Return-event dating matches the ladder: a delivery-recognised order
    // returned in range reverses here even when delivered earlier (cross-
    // period rule — P1 is never rewritten). Undated returns reverse nothing.
    const inReturnEvent =
      recognisedEver && ret.reversesRevenue && inRange(ret.returnAt, range);

    const lineGrosses = order.items.map((i) => i.price * i.quantity);
    const effectiveDiscount =
      order.discountType === 'percentage'
        ? order.subtotal * (order.discount / 100)
        : order.discount;
    // Single §2 definition — same call, same args as the ladder.
    const allocated = allocateDiscount(lineGrosses, effectiveDiscount);
    const lineNets = allocated.map((a) => a.net);
    const orderNet = lineNets.reduce((s, n) => s + n, 0);
    const n = order.items.length;
    // Allocation weights always sum to 1 (equal split when the order nets to
    // zero — e.g. fully discounted — so weights still foot to order totals).
    const weights =
      orderNet > 0
        ? lineNets.map((net) => net / orderNet)
        : n > 0
          ? order.items.map(() => 1 / n)
          : [];

    const paidFees = order.payments
      .filter((p) => p.status === PaymentStatus.PAID)
      .reduce((s, p) => s + (p.feeAmount ?? 0), 0);
    const hasMissingFee = order.payments.some(
      (p) =>
        p.status === PaymentStatus.PAID &&
        (p.feeAmount === null || p.feeAmount === undefined),
    );
    const shippingCost = order.shippingCost ?? 0;
    const missingShip =
      order.shippingCost === null || order.shippingCost === undefined;

    order.items.forEach((line, idx) => {
      const weight = weights[idx] ?? 0;
      for (const attr of expandLine(line)) {
        if (!matchesScope(attr, line, scope)) continue;
        // Undelivered, unreturned orders contribute nothing to any figure —
        // skip before touching an acc so pipeline-only products never appear
        // as zero rows in the P&L list (pipeline belongs to P5).
        if (!inCohort && !inReturnEvent) continue;
        const acc = accFor(attr.productId, attr.variantId);
        if (inCohort) {
          const grossShare = lineGrosses[idx] * attr.share;
          const netShare = lineNets[idx] * attr.share;
          acc.gross += grossShare;
          acc.discount += grossShare - netShare;
          acc.units += attr.units;
          if (
            line.costSnapshot !== null &&
            line.costSnapshot !== undefined
          ) {
            // Direct — costSnapshot only, never a standardCost fallback.
            acc.cogs += line.costSnapshot * line.quantity * attr.share;
          } else {
            acc.uncostedUnits += attr.units;
            acc.uncostedLines += 1;
            uncostedLines.push({
              orderId: order.id,
              orderItemId: line.orderItemId,
              productId: attr.productId,
              variantId: attr.variantId,
              quantity: attr.units,
              lineNet: netShare,
            });
          }
          acc.marketing += line.marketingCost * attr.share;
          acc.fulfillment += shippingCost * weight * attr.share;
          acc.fees += paidFees * weight * attr.share;
          if (missingShip && shippingCost * weight * attr.share >= 0) {
            // Coverage honesty: a missing order shippingCost means the
            // allocated slice understates — flag, never invent.
            if (weight * attr.share > 0) acc.missingShippingCost = true;
          }
          if (hasMissingFee && paidFees * weight * attr.share >= 0) {
            if (weight * attr.share > 0) acc.missingFee = true;
          }
          markOrders(acc, order.id, false);
        }
        if (inReturnEvent) {
          const netShare = lineNets[idx] * attr.share;
          acc.returns += netShare;
          acc.returnedUnits += attr.units;
          if (
            line.costSnapshot !== null &&
            line.costSnapshot !== undefined
          ) {
            acc.returnedCogs +=
              line.costSnapshot * line.quantity * attr.share;
          }
          markOrders(acc, order.id, true);
        }
      }
    });
  }

  const variants = [...accs.values()].map((a) => ({
    ...a,
    recognisedOrders: [...a.recognisedOrders].sort(),
    returnOrders: [...a.returnOrders].sort(),
  }));
  const sum = (pick: (a: ProductVariantAcc) => number) =>
    variants.reduce((s, a) => s + pick(a), 0);
  const cogs = sum((a) => a.cogs);
  const returnedCogs = sum((a) => a.returnedCogs);
  const totals = {
    gross: sum((a) => a.gross),
    discount: sum((a) => a.discount),
    returns: sum((a) => a.returns),
    net: 0,
    cogs,
    returnedCogs,
    units: sum((a) => a.units),
    marketing: sum((a) => a.marketing),
    fulfillment: sum((a) => a.fulfillment),
    fees: sum((a) => a.fees),
    contribution: 0,
    uncostedUnits: sum((a) => a.uncostedUnits),
    uncostedLines: sum((a) => a.uncostedLines),
  };
  totals.net = totals.gross - totals.discount - totals.returns;
  totals.contribution =
    totals.net -
    (totals.cogs - totals.returnedCogs) -
    totals.fulfillment -
    totals.fees -
    totals.marketing;
  return { variants, uncostedLines, totals };
}

/** Parent = Σ children (derived, never stored). Margins via the P1 ladder. */
export function rollUpParent(children: ProductVariantAcc[]): {
  gross: number;
  discount: number;
  returns: number;
  net: number;
  cogs: number;
  returnedCogs: number;
  units: number;
  returnedUnits: number;
  marketing: number;
  fulfillment: number;
  fees: number;
  contribution: number;
  contributionMargin: number | null;
  recognisedOrders: string[];
  returnOrders: string[];
  returnRate: number | null;
  uncostedUnits: number;
  uncostedLines: number;
  missingShippingCost: boolean;
  missingFee: boolean;
} {
  const sum = (pick: (a: ProductVariantAcc) => number) =>
    children.reduce((s, a) => s + pick(a), 0);
  const gross = sum((a) => a.gross);
  const discount = sum((a) => a.discount);
  const returns = sum((a) => a.returns);
  const net = gross - discount - returns;
  const cogs = sum((a) => a.cogs);
  const returnedCogs = sum((a) => a.returnedCogs);
  const contribution =
    net -
    (cogs - returnedCogs) -
    sum((a) => a.fulfillment) -
    sum((a) => a.fees) -
    sum((a) => a.marketing);
  const recognisedOrders = Array.from(
    new Set(children.flatMap((a) => a.recognisedOrders)),
  ).sort();
  const returnOrders = Array.from(
    new Set(children.flatMap((a) => a.returnOrders)),
  ).sort();
  return {
    gross,
    discount,
    returns,
    net,
    cogs,
    returnedCogs,
    units: sum((a) => a.units),
    returnedUnits: sum((a) => a.returnedUnits),
    marketing: sum((a) => a.marketing),
    fulfillment: sum((a) => a.fulfillment),
    fees: sum((a) => a.fees),
    contribution,
    contributionMargin: computeMargin({ profit: contribution, netSales: net }),
    recognisedOrders,
    returnOrders,
    returnRate:
      recognisedOrders.length > 0
        ? returnOrders.length / recognisedOrders.length
        : null,
    uncostedUnits: sum((a) => a.uncostedUnits),
    uncostedLines: sum((a) => a.uncostedLines),
    missingShippingCost: children.some((a) => a.missingShippingCost),
    missingFee: children.some((a) => a.missingFee),
  };
}

// ---------------------------------------------------------------------------
// Enveloped rows.
// ---------------------------------------------------------------------------

export interface ProductPnlRow {
  productId: string;
  name: string;
  stock: number;
  movementClass: 'Dead' | 'Fast' | 'Slow' | 'Normal';
  doi: number | null;
  lowMargin: boolean;
  gross: KpiValue;
  discounts: KpiValue;
  returns: KpiValue;
  netSales: KpiValue;
  units: KpiValue;
  cogs: KpiValue;
  marketing: KpiValue;
  fulfillment: KpiValue;
  fees: KpiValue;
  contribution: KpiValue;
  contributionMargin: number | null;
  recognisedOrders: number;
  returnOrders: number;
  returnRate: KpiValue;
  uncostedUnits: number;
  uncostedLines: number;
}

export interface ProductVariantRow extends ProductPnlRow {
  variantId: string | null;
  variantLabel: string;
}

const DATE_BASIS_REVENUE = 'Delivered transition';
const DATE_BASIS_ATTRIBUTION = 'order attribution (analytical dimension)';
const DATE_BASIS_COHORT = 'recognised order cohort';

@Injectable()
export class AnalyticsProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly cache: CacheService,
  ) {}

  private money(
    amount: number,
    state: 'actual' | 'unavailable' | 'estimated',
    opts: { dateBasis: string; basis: KpiValue['basis']; empty: boolean; reason?: string },
  ): KpiValue {
    if (opts.empty) return kpiNoData('no recognised orders in range');
    if (state === 'unavailable') {
      return {
        value: amount,
        state: 'unavailable',
        reason: opts.reason ?? 'unavailable — see coverage',
        basis: opts.basis,
        dateBasis: opts.dateBasis,
      };
    }
    if (state === 'estimated') {
      return {
        value: amount,
        state: 'estimated',
        reason: opts.reason ?? 'estimated — see coverage',
        basis: opts.basis,
        dateBasis: opts.dateBasis,
      };
    }
    if (amount === 0) {
      return { value: 0, state: 'zero', reason: opts.reason ?? 'measured zero', basis: opts.basis, dateBasis: opts.dateBasis };
    }
    return kpiOk(amount, { basis: opts.basis, dateBasis: opts.dateBasis });
  }

  private async fetchCandidates(
    ctx: ResolvedAnalyticsContext,
    marketingOrderIds: string[] | undefined,
  ) {
    const { range, filters } = ctx;
    const where = this.filters.buildOrderWhere(filters, marketingOrderIds);
    const orders = await this.prisma.order.findMany({
      // Same wider-window rule as the ladder: recognition dates live in
      // timeline JSONB; createdAt <= range.end is the only safe SQL bound.
      where: { ...where, createdAt: { lte: range.end } },
      select: {
        id: true,
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
            id: true,
            productId: true,
            variantId: true,
            price: true,
            quantity: true,
            costSnapshot: true,
            costType: true,
            sourceWarehouseId: true,
            product: {
              select: {
                categoryId: true,
                productCategories: { select: { categoryId: true } },
              },
            },
            comboComponents: {
              select: {
                productId: true,
                variantId: true,
                totalQuantity: true,
                product: {
                  select: {
                    categoryId: true,
                    productCategories: { select: { categoryId: true } },
                  },
                },
              },
            },
            marketingCosts: { select: { marketingCost: true } },
          },
        },
        payments: {
          select: { amount: true, status: true, feeAmount: true },
        },
        dispatches: {
          select: { deliveredAt: true },
          orderBy: { deliveredAt: 'desc' },
        },
      },
    });
    return { orders, where };
  }

  private toOrderInputs(rawOrders: any[]): ProductOrderInput[] {
    return rawOrders.map((o: any): ProductOrderInput => {
      const deliveredAts = (o.dispatches ?? [])
        .map((d: any) => d.deliveredAt)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      const catIdsOf = (p: any): string[] => {
        const ids = new Set<string>();
        if (p?.categoryId) ids.add(p.categoryId);
        for (const pc of p?.productCategories ?? []) {
          if (pc?.categoryId) ids.add(pc.categoryId);
        }
        return [...ids];
      };
      return {
        id: o.id,
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
        items: (o.items ?? []).map((i: any): ProductLineInput => ({
          orderItemId: i.id,
          productId: i.productId,
          variantId: i.variantId,
          price: Number(i.price),
          quantity: i.quantity,
          costSnapshot: i.costSnapshot === null ? null : Number(i.costSnapshot),
          costType:
            i.costType === 'actual' || i.costType === 'estimated'
              ? i.costType
              : null,
          sourceWarehouseId: i.sourceWarehouseId,
          categoryIds: catIdsOf(i.product),
          comboComponents: (i.comboComponents ?? []).map((c: any) => ({
            productId: c.productId,
            variantId: c.variantId,
            totalQuantity: c.totalQuantity,
            categoryIds: catIdsOf(c.product),
          })),
          marketingCost: (i.marketingCosts ?? []).reduce(
            (s: number, m: any) => s + Number(m.marketingCost),
            0,
          ),
        })),
        payments: (o.payments ?? []).map((p: any) => ({
          amount: Number(p.amount),
          status: p.status,
          feeAmount: p.feeAmount === null ? null : Number(p.feeAmount),
        })),
      };
    });
  }

  private applyCustomerSegment(
    candidates: ProductOrderInput[],
    ctx: ResolvedAnalyticsContext,
  ): ProductOrderInput[] {
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

  private async resolveSearchIds(
    query: ProductsQueryDto,
  ): Promise<string[] | undefined> {
    if (!query.search?.trim()) return undefined;
    const rows = await this.prisma.product.findMany({
      where: { name: { contains: query.search.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async productInfo(
    ids: string[],
  ): Promise<
    Map<string, { name: string; stock: number; variants: { id: string; label: string; stock: number }[] }>
  > {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        managedStockQuantity: true,
        variants: {
          select: { id: true, sku: true, managedStockQuantity: true },
        },
      },
    });
    return new Map(
      rows.map((p: any) => [
        p.id,
        {
          name: p.name,
          stock: p.managedStockQuantity ?? 0,
          variants: (p.variants ?? []).map((v: any) => ({
            id: v.id,
            label: v.sku ?? v.id,
            stock: v.managedStockQuantity ?? 0,
          })),
        },
      ]),
    );
  }

  private envelopRow(
    productId: string,
    name: string,
    children: ProductVariantAcc[],
    info: { stock: number; variants: { id: string; label: string; stock: number }[] } | undefined,
    periodDays: number,
    empty: boolean,
  ): ProductPnlRow {
    const parent = rollUpParent(children);
    const stock = info
      ? children.length > 0
        ? children.reduce(
            (s, c) =>
              s +
              (c.variantId
                ? (info.variants.find((v) => v.id === c.variantId)?.stock ?? 0)
                : info.stock),
            0,
          )
        : info.stock
      : 0;
    const movementClass = classifyMovement({
      unitsSold: parent.units,
      closingStock: stock,
      periodDays,
    });
    const doi =
      parent.units > 0
        ? computeDOI({ unitsSold: parent.units, closingStock: stock, periodDays })
        : null;
    const margin = parent.contributionMargin;
    const cogsState =
      parent.uncostedUnits > 0 ? 'unavailable' as const : 'actual' as const;
    const base = { dateBasis: DATE_BASIS_REVENUE as string, empty };
    return {
      productId,
      name,
      stock,
      movementClass,
      doi,
      lowMargin: margin !== null && margin < LOW_CONTRIBUTION_MARGIN,
      gross: this.money(parent.gross, 'actual', { ...base, basis: 'direct', reason: 'own lines (combos expanded)' }),
      discounts: this.money(parent.discount, 'actual', { ...base, basis: 'direct' }),
      returns: parent.returnOrders.length > 0
        ? this.money(parent.returns, 'actual', { ...base, basis: 'direct', dateBasis: 'return transition' })
        : kpiZero('no return events in range'),
      netSales: this.money(parent.net, 'actual', { ...base, basis: 'direct' }),
      units: this.money(parent.units, 'actual', { ...base, basis: 'direct', reason: 'recognised units (combos via totalQuantity)' }),
      cogs: this.money(parent.cogs - parent.returnedCogs, cogsState, {
        ...base,
        basis: 'direct',
        reason:
          cogsState === 'unavailable'
            ? `${parent.uncostedUnits} unit(s) without costSnapshot — see uncosted fix-list`
            : 'costSnapshot only (no standardCost fallback)',
      }),
      marketing: this.money(parent.marketing, 'actual', {
        ...base,
        basis: 'attributed',
        dateBasis: DATE_BASIS_ATTRIBUTION,
        reason: 'ProductMarketingCost per orderItemId — company total stays spend-date (§2.4)',
      }),
      fulfillment: this.money(parent.fulfillment, parent.missingShippingCost ? 'unavailable' : 'actual', {
        ...base,
        basis: 'allocated',
        dateBasis: DATE_BASIS_COHORT,
        reason: parent.missingShippingCost
          ? 'order shippingCost × lineNet ÷ orderNet — some orders lack shippingCost'
          : 'order shippingCost × lineNet ÷ orderNet',
      }),
      fees: this.money(parent.fees, parent.missingFee ? 'unavailable' : 'actual', {
        ...base,
        basis: 'allocated',
        dateBasis: DATE_BASIS_COHORT,
        reason: parent.missingFee
          ? 'order PAID fees × lineNet ÷ orderNet — some payments lack feeAmount'
          : 'order PAID fees × lineNet ÷ orderNet',
      }),
      contribution: this.money(parent.contribution, cogsState === 'unavailable' || parent.missingShippingCost || parent.missingFee ? 'unavailable' : 'actual', {
        ...base,
        basis: undefined,
        reason: 'Contribution is the product bottom line — OPEX never allocated',
      }),
      contributionMargin: margin,
      recognisedOrders: parent.recognisedOrders.length,
      returnOrders: parent.returnOrders.length,
      returnRate:
        parent.returnRate === null
          ? { value: null, state: 'no_data', reason: 'no recognised orders containing this product', dateBasis: 'return transition' }
          : parent.returnRate === 0
            ? { value: 0, state: 'zero', reason: RETURN_INCIDENCE_LABEL, dateBasis: 'return transition' }
            : { value: parent.returnRate, state: 'ok', reason: RETURN_INCIDENCE_LABEL, dateBasis: 'return transition' },
      uncostedUnits: parent.uncostedUnits,
      uncostedLines: parent.uncostedLines,
    };
  }

  private async buildRows(
    query: ProductsQueryDto,
  ): Promise<{
    rows: ProductPnlRow[];
    result: ProductPnlResult;
    ctx: ResolvedAnalyticsContext;
    info: Map<string, { name: string; stock: number; variants: { id: string; label: string; stock: number }[] }>;
  }> {
    const ctx = this.filters.resolveContext(query);
    const { filters } = ctx;
    const [marketingOrderIds, searchIds] = await Promise.all([
      filters.marketingSource
        ? this.filters.resolveMarketingOrderIds(filters.marketingSource)
        : undefined,
      this.resolveSearchIds(query),
    ]);
    const candidates = await this.fetchScopedCandidates(ctx, marketingOrderIds);
    return this.rowsFromCandidates(query, ctx, candidates, searchIds);
  }

  private async fetchScopedCandidates(
    ctx: ResolvedAnalyticsContext,
    marketingOrderIds: string[] | undefined,
  ): Promise<ProductOrderInput[]> {
    const { orders: raw } = await this.fetchCandidates(ctx, marketingOrderIds);
    return this.applyCustomerSegment(this.toOrderInputs(raw), ctx);
  }

  private async rowsFromCandidates(
    query: ProductsQueryDto,
    ctx: ResolvedAnalyticsContext,
    candidates: ProductOrderInput[],
    searchIds: string[] | undefined,
  ): Promise<{
    rows: ProductPnlRow[];
    result: ProductPnlResult;
    ctx: ResolvedAnalyticsContext;
    info: Map<string, { name: string; stock: number; variants: { id: string; label: string; stock: number }[] }>;
  }> {
    const { filters } = ctx;
    const scope: ProductScope = {
      productId: filters.productId,
      variantId: filters.variantId,
      categoryId: filters.categoryId,
      warehouseId: filters.warehouseId,
      productIds: searchIds,
    };
    const result = computeProductPnl({ range: ctx.range, orders: candidates, scope });
    const byProduct = new Map<string, ProductVariantAcc[]>();
    for (const v of result.variants) {
      const list = byProduct.get(v.productId) ?? [];
      list.push(v);
      byProduct.set(v.productId, list);
    }
    const info = await this.productInfo([...byProduct.keys()]);
    const empty = result.variants.length === 0;
    const rows = [...byProduct.entries()].map(([productId, children]) =>
      this.envelopRow(
        productId,
        info.get(productId)?.name ?? productId,
        children,
        info.get(productId),
        ctx.range.periodDays,
        empty,
      ),
    );
    return { rows, result, ctx, info };
  }

  private sortRows(
    rows: ProductPnlRow[],
    query: ProductsQueryDto,
  ): ProductPnlRow[] {
    const sort = query.sort ?? 'netSales';
    const dir = query.dir === 'asc' ? 1 : -1;
    const metric = (r: ProductPnlRow): number | null => {
      switch (sort) {
        case 'units':
          return r.units.value;
        case 'contribution':
          return r.contribution.value;
        case 'margin':
          return r.contributionMargin;
        case 'returnRate':
          return r.returnRate.value;
        case 'netSales':
        default:
          return r.netSales.value;
      }
    };
    return [...rows].sort((a, b) => {
      const av = metric(a);
      const bv = metric(b);
      // Nulls always last — a missing margin/rate is not a zero.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }

  private respond<T>(
    data: T,
    ctx: ResolvedAnalyticsContext,
    result: ProductPnlResult,
  ): { data: T; meta: AnalyticsMeta } {
    return {
      data,
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: {
          uncostedUnits: result.totals.uncostedUnits,
          uncostedLines: result.totals.uncostedLines,
        },
        ladderState:
          result.totals.uncostedUnits > 0 ? 'unavailable' : 'actual',
        thresholds: {
          lowContributionMargin: LOW_CONTRIBUTION_MARGIN,
          lowMarginRationale: LOW_MARGIN_RATIONALE,
          movementFastDoiMax: 30,
          movementSlowDoiMin: 90,
          movementRationale: MOVEMENT_RATIONALE,
        },
        dateBasis:
          'revenue-date (Delivered); returns at return transition; marketing per orderItemId attribution; fulfillment/fees allocated by lineNet weight',
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

  async getProducts(query: ProductsQueryDto) {
    const key = analyticsCacheKey('products', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const { rows, result, ctx } = await this.buildRows(query);
    const response = this.respond(
      {
        rows: this.sortRows(rows, query),
        totals: {
          netSales: result.totals.net,
          contribution: result.totals.contribution,
          units: result.totals.units,
        },
        uncosted: {
          units: result.totals.uncostedUnits,
          lines: result.totals.uncostedLines,
        },
        contributionFloor: PRODUCT_CONTRIBUTION_FLOOR_STATEMENT,
      },
      ctx,
      result,
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  async getProductDetail(productId: string, query: ProductsQueryDto) {
    const key = analyticsCacheKey(`products/${productId}`, query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const scoped: ProductsQueryDto = { ...query, productId };
    const ctx = this.filters.resolveContext(scoped);
    const { filters } = ctx;
    const [marketingOrderIds, searchIds] = await Promise.all([
      filters.marketingSource
        ? this.filters.resolveMarketingOrderIds(filters.marketingSource)
        : undefined,
      this.resolveSearchIds(scoped),
    ]);
    const candidates = await this.fetchScopedCandidates(ctx, marketingOrderIds);
    const { result, info } = await this.rowsFromCandidates(scoped, ctx, candidates, searchIds);
    const children = result.variants.filter((v) => v.productId === productId);
    const meta = info.get(productId);
    const parent = this.envelopRow(
      productId,
      meta?.name ?? productId,
      children,
      meta,
      ctx.range.periodDays,
      children.length === 0,
    );
    const variants: ProductVariantRow[] = children.map((c) => {
      const single = this.envelopRow(
        productId,
        meta?.name ?? productId,
        [c],
        meta,
        ctx.range.periodDays,
        false,
      );
      const label = c.variantId
        ? (meta?.variants.find((v) => v.id === c.variantId)?.label ?? c.variantId)
        : 'Simple product';
      const stock = c.variantId
        ? (meta?.variants.find((v) => v.id === c.variantId)?.stock ?? 0)
        : (meta?.stock ?? 0);
      return { ...single, variantId: c.variantId, variantLabel: label, stock };
    });

    // Performance trend: each bucket foots independently with the period's
    // own events (cross-period rule, §2.1) — same pure fn, narrower ranges.
    const granularity = query.granularity ?? ctx.range.granularity;
    const effectiveGranularity = fittingGranularity(
      ctx.range.start,
      ctx.range.end,
      granularity,
    );
    const edges = bucketEdges(ctx.range.start, ctx.range.end, effectiveGranularity);
    const points = edges.map((edge) => {
      const r = computeProductPnl({
        range: { start: edge.start, end: edge.end },
        orders: candidates,
        scope: { productId },
      });
      const row = r.variants.filter((v) => v.productId === productId);
      const net = row.reduce((s, v) => s + (v.gross - v.discount - v.returns), 0);
      return {
        bucketStart: edge.start.toISOString(),
        label: edge.label,
        netSales: net,
        grossSales: row.reduce((s, v) => s + v.gross, 0),
        recognisedOrders: new Set(row.flatMap((v) => v.recognisedOrders)).size,
      };
    });

    const response = this.respond(
      {
        product: {
          id: productId,
          name: meta?.name ?? productId,
          stock: parent.stock,
          movementClass: parent.movementClass,
          doi: parent.doi,
        },
        parent,
        variants,
        trend: {
          requestedGranularity: granularity,
          granularity: effectiveGranularity,
          points,
        },
        uncosted: {
          units: parent.uncostedUnits,
          lines: parent.uncostedLines,
          rows: result.uncostedLines.filter((l) => l.productId === productId),
        },
        contributionFloor: PRODUCT_CONTRIBUTION_FLOOR_STATEMENT,
      },
      ctx,
      result,
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  async getUncosted(query: ProductsQueryDto) {
    const key = analyticsCacheKey('products-uncosted', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const { result, ctx, info } = await this.buildRows(query);
    const rows = result.uncostedLines.map((l) => ({
      ...l,
      productName: info.get(l.productId)?.name ?? l.productId,
      variantLabel: l.variantId
        ? (info.get(l.productId)?.variants.find((v) => v.id === l.variantId)?.label ?? l.variantId)
        : 'Simple product',
    }));
    const response = this.respond(
      {
        rows,
        totals: {
          units: result.totals.uncostedUnits,
          lines: result.totals.uncostedLines,
        },
      },
      ctx,
      result,
    );
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /**
   * Reconciliation inputs (R1/R2). Same filter context as the ladder; the
   * scoped flag tells R1 when a product line-scope is active (identity holds
   * on the unscoped scope — warn, never a silent pass/fail).
   */
  async getAggregates(query: ProductsQueryDto): Promise<{
    productNetSum: number;
    parents: { productId: string; parentNet: number; variantNetSum: number }[];
    scoped: boolean;
  }> {
    const ctx = this.filters.resolveContext(query);
    const { filters } = ctx;
    const [marketingOrderIds, searchIds] = await Promise.all([
      filters.marketingSource
        ? this.filters.resolveMarketingOrderIds(filters.marketingSource)
        : undefined,
      this.resolveSearchIds(query),
    ]);
    const candidates = await this.fetchScopedCandidates(ctx, marketingOrderIds);
    const result = computeProductPnl({
      range: ctx.range,
      orders: candidates,
      scope: {
        productId: filters.productId,
        variantId: filters.variantId,
        categoryId: filters.categoryId,
        warehouseId: filters.warehouseId,
        productIds: searchIds,
      },
    });
    const byProduct = new Map<string, ProductVariantAcc[]>();
    for (const v of result.variants) {
      const list = byProduct.get(v.productId) ?? [];
      list.push(v);
      byProduct.set(v.productId, list);
    }
    return {
      productNetSum: result.totals.net,
      parents: [...byProduct.entries()].map(([productId, children]) => ({
        productId,
        parentNet: rollUpParent(children).net,
        variantNetSum: children.reduce(
          (s, v) => s + (v.gross - v.discount - v.returns),
          0,
        ),
      })),
      scoped: hasProductLineScope(query),
    };
  }
}
