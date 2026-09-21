/**
 * P4 product analytics tests (§2.6, §7.1 aggregation/dimensions).
 *
 * Pure computeProductPnl()/rollUpParent()/expandLine() over fixtures
 * (recognition via metric-contract, never duplicated) + service fetch wiring
 * (trashed excluded) + R1/R2 registry behaviour through evaluateChecks.
 */
import {
  computeProductPnl,
  rollUpParent,
  expandLine,
  type ProductLineInput,
  type ProductOrderInput,
} from '../analytics-products.service';
import { AnalyticsProductsService } from '../analytics-products.service';
import { AnalyticsFilterService } from '../analytics-filter.service';
import {
  evaluateChecks,
  type ReconciliationInput,
} from '../analytics-reconciliation.service';

const RANGE = {
  start: new Date('2026-09-01T00:00:00+06:00'),
  end: new Date('2026-09-30T17:59:59.999Z'),
};

const D = (s: string) => new Date(s);

function deliveredAt(ts: string) {
  return [{ status: 'Delivered', timestamp: ts }];
}

let lineSeq = 0;

function line(
  productId: string | null,
  price: number,
  quantity: number,
  extra: Partial<ProductLineInput> = {},
): ProductLineInput {
  lineSeq += 1;
  return {
    orderItemId: `li${lineSeq}`,
    productId,
    variantId: null,
    price,
    quantity,
    costSnapshot: 60,
    costType: 'actual',
    sourceWarehouseId: null,
    categoryIds: [],
    comboComponents: [],
    marketingCost: 0,
    ...extra,
  };
}

function order(
  id: string,
  items: ProductLineInput[],
  extra: Partial<ProductOrderInput> = {},
): ProductOrderInput {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return {
    id,
    subtotal,
    shippingCharge: 0,
    discount: 0,
    discountType: 'flat',
    status: 'Delivered',
    timeline: deliveredAt('2026-09-10T10:00:00+06:00'),
    items,
    payments: [],
    ...extra,
  };
}

function run(orders: ProductOrderInput[]) {
  return computeProductPnl({ range: RANGE, orders });
}

function byKey(result: ReturnType<typeof run>, productId: string, variantId: string | null) {
  const found = result.variants.find(
    (v) => v.productId === productId && v.variantId === variantId,
  );
  if (!found) throw new Error(`missing acc ${productId}::${variantId ?? ''}`);
  return found;
}

// ─── parent = Σ variants ─────────────────────────────────────────────────────

describe('parent aggregation (derived, never stored)', () => {
  it('rolls two variants up to the parent exactly', () => {
    const r = run([
      order('o1', [
        line('P', 500, 2, { variantId: 'v1' }),
        line('P', 500, 1, { variantId: 'v2' }),
      ]),
    ]);
    expect(r.variants).toHaveLength(2);
    const v1 = byKey(r, 'P', 'v1');
    const v2 = byKey(r, 'P', 'v2');
    expect(v1.gross).toBe(1000);
    expect(v2.gross).toBe(500);
    const parent = rollUpParent([v1, v2]);
    expect(parent.gross).toBe(1500);
    expect(parent.net).toBe(v1.gross - v1.discount - v1.returns + (v2.gross - v2.discount - v2.returns));
    expect(parent.units).toBe(v1.units + v2.units);
    expect(parent.cogs).toBe(v1.cogs + v2.cogs);
    expect(parent.contribution).toBe(
      parent.net - (parent.cogs - parent.returnedCogs) - parent.fulfillment - parent.fees - parent.marketing,
    );
    // R2 holds on the same rows: parent nets foot to variant nets.
    expect(parent.net).toBe(
      [v1, v2].reduce((s, v) => s + (v.gross - v.discount - v.returns), 0),
    );
  });

  it('gives simple products one implicit child (variantId null)', () => {
    const r = run([order('o1', [line('SIMPLE', 250, 4)])]);
    expect(r.variants).toHaveLength(1);
    const child = byKey(r, 'SIMPLE', null);
    expect(child.variantId).toBeNull();
    expect(child.gross).toBe(1000);
    expect(child.units).toBe(4);
    const parent = rollUpParent([child]);
    expect(parent.gross).toBe(1000);
    expect(parent.net).toBe(1000);
  });
});

// ─── combo expansion: never double-count ─────────────────────────────────────

describe('combo expansion', () => {
  const comboLine = line('COMBO-HOST', 900, 1, {
    comboComponents: [
      { productId: 'A', variantId: null, totalQuantity: 2, categoryIds: [] },
      { productId: 'B', variantId: null, totalQuantity: 1, categoryIds: [] },
    ],
  });

  it('expands to components by quantity share and attributes nothing to the host', () => {
    expect(expandLine(comboLine).map((a) => a.productId).sort()).toEqual(['A', 'B']);
    const r = run([order('o1', [comboLine])]);
    expect(r.variants.find((v) => v.productId === 'COMBO-HOST')).toBeUndefined();
    const a = byKey(r, 'A', null);
    const b = byKey(r, 'B', null);
    expect(a.gross).toBeCloseTo(600, 8);
    expect(b.gross).toBeCloseTo(300, 8);
    expect(a.gross + b.gross).toBeCloseTo(900, 8);
    expect(a.units).toBe(2);
    expect(b.units).toBe(1);
  });

  it('counts a component alongside its own direct line exactly once each', () => {
    const r = run([
      order('o1', [comboLine]),
      order('o2', [line('A', 300, 1)]),
    ]);
    const a = byKey(r, 'A', null);
    // 600 (combo share) + 300 (own line) — the combo host contributes nothing.
    expect(a.gross).toBeCloseTo(900, 8);
    expect(a.units).toBe(3);
    expect(r.totals.gross).toBeCloseTo(1200, 8);
  });
});

// ─── return incidence is order-level, never fractional ───────────────────────

describe('return incidence (order-level)', () => {
  const returnedTimeline = [
    { status: 'Delivered', timestamp: '2026-09-05T10:00:00+06:00' },
    { status: 'Returned', timestamp: '2026-09-20T10:00:00+06:00' },
  ];

  it('counts orders, reverses whole lines, and rates incidence per order', () => {
    const r = run([
      order('o1', [line('P', 500, 2)]),
      order('o2', [line('P', 500, 1)], { timeline: returnedTimeline }),
    ]);
    const acc = byKey(r, 'P', null);
    // Whole-line reversal: no fractional per-item attribution exists.
    expect(acc.returns).toBe(500);
    expect(acc.returnedUnits).toBe(1);
    expect(acc.returnedCogs).toBe(60);
    expect(acc.recognisedOrders).toEqual(['o1', 'o2']);
    expect(acc.returnOrders).toEqual(['o2']);
    const parent = rollUpParent([acc]);
    expect(parent.returnRate).toBe(0.5);
  });

  it('takes no reversal for return-before-delivery (F9)', () => {
    const r = run([
      order('o1', [line('P', 500, 1)], {
        status: 'Return Pending',
        timeline: [{ status: 'Return Pending', timestamp: '2026-09-12T10:00:00+06:00' }],
      }),
    ]);
    expect(r.totals.returns).toBe(0);
    expect(r.variants).toHaveLength(0);
  });
});

// ─── marketing attributed; fulfillment/fees allocated with weights summing ───

describe('attributed and allocated lines', () => {
  it('takes marketing cost from ProductMarketingCost per orderItemId (attributed)', () => {
    const r = run([
      order('o1', [line('P', 500, 2, { marketingCost: 150 })]),
    ]);
    expect(byKey(r, 'P', null).marketing).toBe(150);
    expect(r.totals.marketing).toBe(150);
  });

  it('splits marketing by combo share, never inventing a company total', () => {
    const combo = line('HOST', 900, 1, {
      marketingCost: 90,
      comboComponents: [
        { productId: 'A', variantId: null, totalQuantity: 2, categoryIds: [] },
        { productId: 'B', variantId: null, totalQuantity: 1, categoryIds: [] },
      ],
    });
    const r = run([order('o1', [combo])]);
    expect(byKey(r, 'A', null).marketing).toBeCloseTo(60, 8);
    expect(byKey(r, 'B', null).marketing).toBeCloseTo(30, 8);
  });

  it('allocates fulfillment and gateway by lineNet weight and the slices sum to order totals', () => {
    const r = run([
      order('o1', [line('P', 400, 1), line('Q', 200, 1)], {
        discount: 0,
        shippingCost: 90,
        payments: [{ amount: 600, status: 'PAID', feeAmount: 30 }],
      }),
    ]);
    const p = byKey(r, 'P', null);
    const q = byKey(r, 'Q', null);
    expect(p.fulfillment).toBeCloseTo(60, 8);
    expect(q.fulfillment).toBeCloseTo(30, 8);
    expect(p.fulfillment + q.fulfillment).toBeCloseTo(90, 8);
    expect(p.fees).toBeCloseTo(20, 8);
    expect(q.fees).toBeCloseTo(10, 8);
    expect(p.fees + q.fees).toBeCloseTo(30, 8);
  });

  it('equal-splits fulfillment and fees on a fully-discounted (zero-net) order so slices foot to order totals', () => {
    const r = run([
      order('o1', [line('P', 400, 1), line('Q', 200, 1)], {
        discount: 600,
        shippingCost: 90,
        payments: [{ amount: 600, status: 'PAID', feeAmount: 30 }],
      }),
    ]);
    const p = byKey(r, 'P', null);
    const q = byKey(r, 'Q', null);
    // Fully discounted: every line nets to zero, so weights fall back to 1/n.
    expect(p.discount).toBeCloseTo(400, 8);
    expect(q.discount).toBeCloseTo(200, 8);
    expect(r.totals.net).toBeCloseTo(0, 8);
    expect(p.fulfillment).toBeCloseTo(45, 8);
    expect(q.fulfillment).toBeCloseTo(45, 8);
    expect(p.fulfillment + q.fulfillment).toBeCloseTo(90, 8);
    expect(p.fees).toBeCloseTo(15, 8);
    expect(q.fees).toBeCloseTo(15, 8);
    expect(p.fees + q.fees).toBeCloseTo(30, 8);
  });

  it('counts only PAID payment fees (PAID→FAILED drops that fee)', () => {    const mk = (feeStatus: string) =>
      run([
        order('o1', [line('P', 500, 1)], {
          payments: [
            { amount: 300, status: 'PAID', feeAmount: 12 },
            { amount: 200, status: feeStatus, feeAmount: 8 },
          ],
        }),
      ]);
    expect(byKey(mk('PAID'), 'P', null).fees).toBe(20);
    expect(byKey(mk('FAILED'), 'P', null).fees).toBe(12);
  });

  it('uses COGS costSnapshot only — never a standardCost fallback', () => {
    const r = run([order('o1', [line('P', 500, 2, { costSnapshot: null, costType: null })])]);
    const acc = byKey(r, 'P', null);
    expect(acc.cogs).toBe(0);
    expect(acc.uncostedUnits).toBe(2);
    expect(acc.uncostedLines).toBe(1);
    expect(r.uncostedLines).toHaveLength(1);
    expect(r.uncostedLines[0]).toMatchObject({ orderId: 'o1', productId: 'P' });
    expect(r.totals.uncostedUnits).toBe(2);
  });
});

// ─── R1 / R2 registry behaviour ──────────────────────────────────────────────

function reconInput(extra: Partial<ReconciliationInput['products']> = {}): ReconciliationInput {
  const ladder = {
    grossSales: 1500,
    discounts: 0,
    returns: 500,
    refundsReversal: 100,
    netSales: 900,
    cogs: 360,
    grossProfit: 540,
    fulfillmentCost: 60,
    paymentFees: 20,
    marketingCost: 100,
    contributionProfit: 360,
    operatingExpenses: 60,
    operatingProfit: 300,
    netProfit: 300,
  };
  return {
    ladder,
    bridge: {
      contributionProfit: 360,
      deliveryChargeRetained: 80,
      fulfillmentMargin: 20,
      totalBusinessContribution: 440,
      operatingProfit: 380,
      netProfit: 380,
      operands: ['contributionProfit', 'deliveryChargeRetained'],
    },
    ledgerNetProfit: 380,
    expensesTotal: 60,
    paidPaymentsTotal: 1000,
    cashCollected: 1000,
    partition: { total: 2, recognised: 2, inFulfilment: 0, cancelled: 0, returnedBeforeDelivery: 0, undatedDeliveries: 0 },
    settlementOnline: { collected: 1000, refunded: 200, retained: 800 },
    fulfillmentOnline: { margin: 20, deliveryChargeRetained: 80, courierCost: 60 },
    revenueBucketHasSettlement: false,
    doubleReversalOrders: [],
    products: {
      // Pre-refund basis: 1500 − 0 − 500 = 1000 == net (900) + refundsReversal (100).
      productNetSum: 1000,
      scoped: false,
      parents: [{ productId: 'P', parentNet: 1000, variantNetSum: 1000 }],
      ...extra,
    },
    marketingIdentity: { allTimeCost: 800, datedCost: 500, undatedCost: 300 },
    marketingPeriodTotal: 500,
    // R7 default: attribution basis agrees with the P&L marketing line.
    marketingAllocationTotal: 100,
    // R8 default: one campaign footing within rounding dust.
    marketingCampaignIdentity: {
      campaigns: [
        {
          campaignId: 'c1',
          name: 'Camp One',
          consumptionCost: 800,
          productCost: 800,
          allocRows: 2,
          pmcRows: 3,
        },
      ],
      nullCampaignConsumption: 0,
    },
    codLeakOrders: [],
    warnings: {
      cogsUnavailableUnits: 0,
      ordersMissingShippingCost: 0,
      paymentsMissingFee: 0,
      timelineLessDeliveries: 0,
      partialFlagged: 0,
      returnPendingInFlight: 0,
      unmappedLocations: 0,
      marketingOverlapCategories: [],
      marketingCost: 100,
      phoneLessGuests: 0,
      shippingRefundInferences: 0,
      consumptionsMissingSpendDate: 0,
      consumptionsMissingSpendAmount: 0,
      codUnsettledOrders: 0,
      codUnsettledCourierCost: 0,
    },
  };
}

function checkOf(input: ReconciliationInput, id: string) {
  const found = evaluateChecks(input).find((c) => c.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

describe('R1 Σ product Net Sales == Business Net Sales', () => {
  it('passes on the pre-refund basis (refunds never allocated to products)', () => {
    expect(checkOf(reconInput(), 'R1')).toMatchObject({ status: 'pass' });
  });

  it('fails when the product sum drifts from net + refundsReversal', () => {
    const bad = reconInput({ productNetSum: 950 });
    expect(checkOf(bad, 'R1')).toMatchObject({ status: 'fail', expected: 1000, actual: 950 });
  });

  it('warns (never pass/fail) while a product line-scope is active', () => {
    const scoped = reconInput({ scoped: true });
    expect(checkOf(scoped, 'R1').status).toBe('warn');
  });
});

describe('R2 Σ variant Net Sales == parent', () => {
  it('passes when every parent foots to its variants', () => {
    expect(checkOf(reconInput(), 'R2')).toMatchObject({ status: 'pass' });
  });

  it('fails naming the offending parents', () => {
    const bad = reconInput({
      parents: [
        { productId: 'P', parentNet: 1000, variantNetSum: 1000 },
        { productId: 'Q', parentNet: 500, variantNetSum: 480 },
      ],
    });
    expect(checkOf(bad, 'R2')).toMatchObject({ status: 'fail', actual: ['Q'] });
  });
});

// ─── trashed excluded at the products fetch ──────────────────────────────────

describe('products fetch wiring', () => {
  it('scopes the order read to non-trashed rows', async () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const filters = new AnalyticsFilterService(prisma);
    const cache: any = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    const svc = new AnalyticsProductsService(prisma, filters, cache);
    await svc.getAggregates({ preset: 'last_30_days' } as any);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ trashedAt: null }),
      }),
    );
  });

  it('ignores undelivered orders for recognised metrics (D4)', () => {
    const r = run([
      order('o1', [line('P', 500, 1)], {
        status: 'Confirmed',
        timeline: [{ status: 'Confirmed', timestamp: '2026-09-10T10:00:00+06:00' }],
      }),
    ]);
    expect(r.totals.gross).toBe(0);
    expect(r.variants).toHaveLength(0);
  });
});
