/**
 * P5 tests — sales & orders (§2.1 lenses + §2.2 + §2.10 derivatives + §7.1).
 *
 * L1/L2/L3 basis dates · funnel counts exclude unsupported stages ·
 * pipeline disjoint from every revenue bucket (leak-guard style) ·
 * settlement pagination + inference labels · Return Loss + Refund Leakage
 * math · COD rows unavailable with the canonical reason.
 */
import { PaymentStatus } from '@prisma/client';
import {
  bookedInRange,
  cashInRange,
  computeFunnel,
  computePipeline,
  computePaymentBreakdown,
  computeCancellations,
  computeReturnBreakdown,
  computeRefundClasses,
  computeReturnLoss,
  computeRefundLeakage,
  computeDeliveryCoverage,
  toSettlementTableRow,
  paginateSettlementTable,
  orderLineNet,
  type SalesOrderInput,
  type SalesRange,
} from '../analytics-sales.service';
import { salesPagination } from '../analytics-sales.dto';
import { computePnl } from '../analytics-pnl.service';

const D = (s: string) => new Date(s);
const RANGE: SalesRange = {
  start: D('2026-09-01T00:00:00+06:00'),
  end: D('2026-09-07T23:59:59.999+06:00'),
};

let seq = 0;
function order(extra: Partial<SalesOrderInput> = {}): SalesOrderInput {
  seq += 1;
  return {
    id: `o${seq}`,
    displayId: `ORD-${seq}`,
    total: 1060,
    subtotal: 1000,
    shippingCharge: 60,
    discount: 0,
    discountType: 'flat',
    status: 'Delivered',
    timeline: [{ status: 'Delivered', timestamp: D('2026-09-03T10:00:00+06:00') }],
    dispatchDeliveredAt: null,
    createdAt: D('2026-09-02T10:00:00+06:00'),
    paymentOptionType: 'FULL_PAYMENT',
    customerId: null,
    customerPhone: null,
    guestPhone: null,
    salesChannel: null,
    source: null,
    shippingCost: 50,
    shippingCostSource: 'manual',
    items: [{ price: 500, quantity: 2, costSnapshot: 300, costType: 'actual' }],
    payments: [
      {
        amount: 1060,
        status: PaymentStatus.PAID,
        gatewayCode: 'bkash',
        createdAt: D('2026-09-02T11:00:00+06:00'),
      },
    ],
    refunds: [],
    ...extra,
  };
}

// ─── L1 / L2 / L3 basis dates ────────────────────────────────────────────────

describe('L1 Booked — Σ Order.total by createdAt, intake only', () => {
  it('counts pre-delivery statuses (intake only — status irrelevant)', () => {
    const pending = order({ id: 'p1', status: 'Pending', timeline: [] });
    const confirmed = order({
      id: 'c1',
      status: 'Confirmed',
      timeline: [{ status: 'Confirmed', timestamp: D('2026-09-03T10:00:00+06:00') }],
    });
    expect(bookedInRange([pending, confirmed], RANGE)).toEqual({
      orders: 2,
      amount: 2120,
    });
  });

  it('excludes orders created outside the range even when delivered inside', () => {
    const early = order({
      id: 'early',
      createdAt: D('2026-08-20T10:00:00+06:00'),
    });
    expect(bookedInRange([early], RANGE)).toEqual({ orders: 0, amount: 0 });
  });
});

describe('L2 Recognised — Delivered cohort dated at the transition', () => {
  function pnlFor(orders: SalesOrderInput[]) {
    return computePnl({
      range: RANGE,
      orders,
      bookedOrders: [],
      cashPayments: [],
      consumptions: [],
      expenses: [],
    });
  }

  it('dates recognition at the Delivered transition, not createdAt', () => {
    const r = pnlFor([
      order({ createdAt: D('2026-08-20T10:00:00+06:00') }),
    ]);
    expect(r.recognisedOrders).toBe(1);
    expect(r.lenses.recognised).toBe(1000);
  });

  it('excludes a delivery outside the range (each period foots independently)', () => {
    const r = pnlFor([
      order({
        timeline: [{ status: 'Delivered', timestamp: D('2026-08-28T10:00:00+06:00') }],
      }),
    ]);
    expect(r.recognisedOrders).toBe(0);
    expect(r.lenses.recognised).toBe(0);
  });

  it('recognises product revenue only — shippingCharge never inside Gross Sales', () => {
    const r = pnlFor([order()]);
    expect(r.grossSales.amount).toBe(1000);
    expect(r.netSales.amount).toBe(1000);
  });
});

describe('L3 Cash Collected — Σ PAID by Payment.createdAt', () => {
  it('sums PAID in range; PENDING and FAILED never count', () => {
    const cash = [
      { amount: 500, status: PaymentStatus.PAID, gatewayCode: 'bkash', createdAt: D('2026-09-02T10:00:00+06:00') },
      { amount: 999, status: PaymentStatus.PENDING, gatewayCode: 'bkash', createdAt: D('2026-09-02T10:00:00+06:00') },
      { amount: 888, status: PaymentStatus.FAILED, gatewayCode: 'bkash', createdAt: D('2026-09-02T10:00:00+06:00') },
      { amount: 777, status: PaymentStatus.PAID, gatewayCode: 'bkash', createdAt: D('2026-08-20T10:00:00+06:00') },
    ];
    expect(cashInRange(cash, RANGE)).toEqual({ payments: 1, amount: 500 });
  });
});

// ─── Funnel ──────────────────────────────────────────────────────────────────

describe('computeFunnel — supported stages only', () => {
  it('marks Add-to-Cart / Checkout-started Not instrumented (never zeros)', () => {
    const stages = computeFunnel([order({ status: 'Pending', timeline: [] })], RANGE);
    const cart = stages.find((s) => s.key === 'add_to_cart')!;
    const checkout = stages.find((s) => s.key === 'checkout_started')!;
    for (const s of [cart, checkout]) {
      expect(s.instrumented).toBe(false);
      expect(s.orders).toBeNull();
      expect(s.value).toBeNull();
      expect(s.reason).toMatch(/Not instrumented/);
    }
  });

  it('counts the intake cohort through the supported chain + outcomes', () => {
    const stages = computeFunnel(
      [
        order({ id: 'b1', status: 'Pending', timeline: [] }),
        order({
          id: 'b2',
          status: 'Confirmed',
          timeline: [{ status: 'Confirmed', timestamp: D('2026-09-03T10:00:00+06:00') }],
        }),
        order({ id: 'b3' }),
        order({
          id: 'b4',
          status: 'Cancelled',
          timeline: [
            { status: 'Confirmed', timestamp: D('2026-09-03T10:00:00+06:00') },
            { status: 'Cancelled', timestamp: D('2026-09-04T10:00:00+06:00') },
          ],
        }),
      ],
      RANGE,
    );
    const at = (k: string) => stages.find((s) => s.key === k)!;
    expect(at('booked').orders).toBe(4);
    expect(at('confirmed').orders).toBe(3);
    expect(at('packed').orders).toBe(1);
    expect(at('delivered').orders).toBe(1);
    expect(at('cancelled').orders).toBe(1);
    expect(at('returned').orders).toBe(0);
    expect(at('confirmed').conversionFromPrev).toBeCloseTo(3 / 4);
  });

  it('excludes orders booked outside the range from the cohort', () => {
    const stages = computeFunnel(
      [order({ createdAt: D('2026-08-01T10:00:00+06:00') })],
      RANGE,
    );
    expect(stages.find((s) => s.key === 'booked')!.orders).toBe(0);
  });
});

// ─── Pipeline leak guard ─────────────────────────────────────────────────────

describe('computePipeline — never in revenue buckets', () => {
  it('holds recognised, delivered-then-returned and pipeline ids disjoint', () => {
    const recognised = order({ id: 'rec' });
    const thenReturned = order({
      id: 'ret',
      status: 'Returned',
      timeline: [
        { status: 'Delivered', timestamp: D('2026-09-02T10:00:00+06:00') },
        { status: 'Returned', timestamp: D('2026-09-04T10:00:00+06:00') },
      ],
    });
    const pending = order({ id: 'pipe1', status: 'Pending', timeline: [] });
    const shipping = order({
      id: 'pipe2',
      status: 'Shipping',
      timeline: [{ status: 'Shipping', timestamp: D('2026-09-03T10:00:00+06:00') }],
    });
    const undeliveredReturn = order({
      id: 'pipe3',
      status: 'Returned',
      timeline: [{ status: 'Returned', timestamp: D('2026-09-03T10:00:00+06:00') }],
    });
    const cancelled = order({
      id: 'pipe4',
      status: 'Cancelled',
      timeline: [{ status: 'Cancelled', timestamp: D('2026-09-03T10:00:00+06:00') }],
    });
    const all = [recognised, thenReturned, pending, shipping, undeliveredReturn, cancelled];
    const pipeline = computePipeline(all);
    expect(pipeline.pipelineOrderIds.sort()).toEqual(['pipe1', 'pipe2', 'pipe3', 'pipe4']);
    expect(pipeline.pipelineOrderIds).not.toContain('rec');
    expect(pipeline.pipelineOrderIds).not.toContain('ret');

    // Pipeline value is labelled pipeline and absent from Net Sales.
    const pnl = computePnl({
      range: RANGE,
      orders: all,
      bookedOrders: [],
      cashPayments: [],
      consumptions: [],
      expenses: [],
    });
    expect(pnl.netSales.amount).toBe(1000);
    expect(pipeline.totalValue).toBe(4 * 1060);
    const intake = pipeline.stages.find((s) => s.key === 'intake')!;
    expect(intake.orders).toBe(1);
    expect(intake.note).toMatch(/never revenue|not revenue/);
    expect(pipeline.stages.find((s) => s.key === 'undelivered_return')!.orders).toBe(1);
    expect(pipeline.stages.find((s) => s.key === 'cancelled')!.orders).toBe(1);
  });
});

// ─── Payment breakdown ───────────────────────────────────────────────────────

describe('computePaymentBreakdown — multi-match labelling', () => {
  it('labels multi-payment orders on every method; unpaid stays separate', () => {
    const multi = order({
      id: 'm1',
      payments: [
        { amount: 600, status: PaymentStatus.PAID, gatewayCode: 'bkash', createdAt: D('2026-09-02T10:00:00+06:00') },
        { amount: 460, status: PaymentStatus.PAID, gatewayCode: 'nagad', createdAt: D('2026-09-02T10:00:00+06:00') },
      ],
    });
    const unpaid = order({ id: 'u1', status: 'Pending', timeline: [], payments: [] });
    const { methods, unpaid: u } = computePaymentBreakdown([multi, unpaid], RANGE);
    expect(methods.find((m) => m.gateway === 'bkash')!.orders).toBe(1);
    expect(methods.find((m) => m.gateway === 'nagad')!.orders).toBe(1);
    expect(methods[0].note).toMatch(/orders with ≥1 PAID payment of this method/);
    expect(u.orders).toBe(1);
    expect(u.bookedValue).toBe(1060);
  });
});

// ─── Cancellations / returns / refunds ───────────────────────────────────────

describe('computeCancellations', () => {
  it('dates by the Cancelled transition; undated cancels count without a date', () => {
    const dated = order({
      id: 'x1',
      status: 'Cancelled',
      timeline: [
        { status: 'Confirmed', timestamp: D('2026-09-03T10:00:00+06:00') },
        { status: 'Cancelled', timestamp: D('2026-09-04T10:00:00+06:00') },
      ],
    });
    const undated = order({ id: 'x2', status: 'Cancelled', timeline: [] });
    const old = order({
      id: 'x3',
      status: 'Cancelled',
      timeline: [{ status: 'Cancelled', timestamp: D('2026-08-01T10:00:00+06:00') }],
      createdAt: D('2026-08-01T09:00:00+06:00'),
    });
    const r = computeCancellations([dated, undated, old], RANGE);
    expect(r.total).toBe(2);
    expect(r.undated).toBe(1);
    expect(r.byPriorStage.find((s) => s.stage === 'confirmed')!.orders).toBe(1);
    expect(r.byPriorStage.find((s) => s.stage === 'intake')!.orders).toBe(1);
  });
});

describe('computeReturnBreakdown (§2.2)', () => {
  it('values return events at Σ lineNet with units and COGS reversal; order-level rate', () => {
    const returned = order({
      id: 'r1',
      timeline: [
        { status: 'Delivered', timestamp: D('2026-09-02T10:00:00+06:00') },
        { status: 'Returned', timestamp: D('2026-09-04T10:00:00+06:00') },
      ],
    });
    const r = computeReturnBreakdown([returned, order({ id: 'k1' }), order({ id: 'k2' })], RANGE, 2);
    expect(r.events).toBe(1);
    expect(r.value).toBe(1000);
    expect(r.units).toBe(2);
    expect(r.cogsReversal).toBe(600);
    expect(r.rate).toBeCloseTo(0.5);
  });

  it('ignores returns before delivery (no reversal) and nulls the rate with no recognised orders', () => {
    const early = order({
      id: 'e1',
      status: 'Returned',
      timeline: [{ status: 'Returned', timestamp: D('2026-09-04T10:00:00+06:00') }],
    });
    const r = computeReturnBreakdown([early], RANGE, 0);
    expect(r.events).toBe(0);
    expect(r.rate).toBeNull();
  });
});

describe('computeRefundClasses (D7 crossover)', () => {
  it('routes reversal / informational / not_a_reversal by delivery × return', () => {
    const reversal = order({
      id: 'v1',
      refunds: [{ amount: 200, status: 'completed', processedAt: D('2026-09-05T10:00:00+06:00'), createdAt: D('2026-09-05T10:00:00+06:00') }],
    });
    const informational = order({
      id: 'v2',
      status: 'Returned',
      timeline: [
        { status: 'Delivered', timestamp: D('2026-09-02T10:00:00+06:00') },
        { status: 'Returned', timestamp: D('2026-09-04T10:00:00+06:00') },
      ],
      refunds: [{ amount: 1060, status: 'completed', processedAt: D('2026-09-05T10:00:00+06:00'), createdAt: D('2026-09-05T10:00:00+06:00') }],
    });
    const neverDelivered = order({
      id: 'v3',
      status: 'Pending',
      timeline: [],
      refunds: [{ amount: 1060, status: 'completed', processedAt: D('2026-09-05T10:00:00+06:00'), createdAt: D('2026-09-05T10:00:00+06:00') }],
    });
    const r = computeRefundClasses([reversal, informational, neverDelivered], RANGE);
    expect(r.reversal).toEqual({ orders: 1, amount: 200 });
    expect(r.informational).toEqual({ orders: 1, amount: 1060 });
    expect(r.not_a_reversal).toEqual({ orders: 1, amount: 1060 });
  });
});

// ─── Return Loss + Refund Leakage ────────────────────────────────────────────

describe('computeReturnLoss (online return events)', () => {
  it('sums courierCost − deliveryChargeRetained; full refund ⇒ retained 0', () => {
    const fullRefund = order({
      id: 'l1',
      timeline: [
        { status: 'Delivered', timestamp: D('2026-09-02T10:00:00+06:00') },
        { status: 'Returned', timestamp: D('2026-09-04T10:00:00+06:00') },
      ],
      refunds: [{ amount: 1060, status: 'completed', processedAt: D('2026-09-05T10:00:00+06:00'), createdAt: D('2026-09-05T10:00:00+06:00') }],
    });
    const r = computeReturnLoss([fullRefund], RANGE);
    expect(r).toMatchObject({ amount: 50, events: 1, unavailableEvents: 0 });
  });

  it('skips COD returns entirely and flags online rows missing courier cost', () => {
    const cod = order({
      id: 'l2',
      paymentOptionType: 'CASH_ON_DELIVERY',
      payments: [],
      timeline: [
        { status: 'Delivered', timestamp: D('2026-09-02T10:00:00+06:00') },
        { status: 'Returned', timestamp: D('2026-09-04T10:00:00+06:00') },
      ],
    });
    const noCost = order({
      id: 'l3',
      shippingCost: null,
      shippingCostSource: null,
      timeline: [
        { status: 'Delivered', timestamp: D('2026-09-02T10:00:00+06:00') },
        { status: 'Returned', timestamp: D('2026-09-04T10:00:00+06:00') },
      ],
    });
    const r = computeReturnLoss([cod, noCost], RANGE);
    expect(r).toMatchObject({ amount: 0, events: 0, unavailableEvents: 1 });
  });
});

describe('computeRefundLeakage (refunds on never-delivered orders)', () => {
  it('counts only completed refunds in range on never-delivered orders', () => {
    const leaked = order({
      id: 'g1',
      status: 'Cancelled',
      timeline: [{ status: 'Cancelled', timestamp: D('2026-09-03T10:00:00+06:00') }],
      refunds: [{ amount: 1060, status: 'completed', processedAt: D('2026-09-04T10:00:00+06:00'), createdAt: D('2026-09-04T10:00:00+06:00') }],
    });
    const delivered = order({
      id: 'g2',
      refunds: [{ amount: 200, status: 'completed', processedAt: D('2026-09-04T10:00:00+06:00'), createdAt: D('2026-09-04T10:00:00+06:00') }],
    });
    const r = computeRefundLeakage([leaked, delivered], RANGE);
    expect(r).toMatchObject({ amount: 1060, refunds: 1, orders: 1 });
  });
});

describe('computeDeliveryCoverage', () => {
  it('buckets online vs COD/unknown with courier cost on unavailable', () => {
    const c = computeDeliveryCoverage([
      order({ id: 'd1' }),
      order({ id: 'd2', paymentOptionType: 'CASH_ON_DELIVERY', payments: [] }),
      order({ id: 'd3', paymentOptionType: null, payments: [] }),
    ]);
    expect(c).toEqual({
      onlineOrders: 1,
      codOrders: 2,
      collectionUnavailableOrders: 2,
      unknownAmount: 100,
    });
  });
});

// ─── Settlement rows + pagination ────────────────────────────────────────────

describe('toSettlementTableRow', () => {
  it('exposes inference labels per §2.10.2 (covered / below / none)', () => {
    const none = toSettlementTableRow(order({ id: 's1' }));
    expect(none.deliveryChargeRetained.inference).toBe('none');
    expect(none.fulfillmentMargin).toMatchObject({ value: 10, state: 'actual' });
    expect(none.disclosure).toBeNull();

    const covered = toSettlementTableRow(
      order({
        id: 's2',
        refunds: [{ amount: 1060, status: 'completed', processedAt: D('2026-09-05T10:00:00+06:00'), createdAt: D('2026-09-05T10:00:00+06:00') }],
      }),
    );
    expect(covered.deliveryChargeRetained).toMatchObject({ value: 0, inference: 'covered' });
    expect(covered.fulfillmentMargin.value).toBe(-50);
    expect(covered.disclosure).toMatch(/labelled, not measured/);

    const below = toSettlementTableRow(
      order({
        id: 's3',
        refunds: [{ amount: 20, status: 'completed', processedAt: D('2026-09-05T10:00:00+06:00'), createdAt: D('2026-09-05T10:00:00+06:00') }],
      }),
    );
    expect(below.deliveryChargeRetained).toMatchObject({ value: 60, inference: 'below' });
  });

  it('marks every COD collection figure unavailable — never inferred', () => {
    const input = order({ id: 's9', paymentOptionType: 'CASH_ON_DELIVERY', payments: [] });
    const row = toSettlementTableRow(input);
    expect(row.collection).toBe('cod');
    expect(row.amountCollected).toMatchObject({ value: null, state: 'unavailable', reason: 'no_courier_settlement_source' });
    expect(row.amountRetained.value).toBeNull();
    expect(row.deliveryChargeRetained.value).toBeNull();
    expect(row.fulfillmentMargin.value).toBeNull();
    expect(row.deliveryChargeRetained.inference).toBe('none');
    // Courier cost still shown and still the ladder's cost.
    expect(row.courierCost).toMatchObject({ value: 50, state: 'actual' });
    expect(row.disclosure).toBe('no_courier_settlement_source');
    expect(row.displayId).toBe(input.displayId);
  });
});

describe('paginateSettlementTable', () => {
  it('pages newest-first with totals', () => {
    const rows = [1, 2, 3].map((n) =>
      toSettlementTableRow(
        order({ id: `pg${n}`, createdAt: D(`2026-09-0${n}T10:00:00+06:00`) }),
      ),
    );
    const p1 = paginateSettlementTable(rows, 1, 2);
    expect(p1.total).toBe(3);
    expect(p1.totalPages).toBe(2);
    expect(p1.rows.map((r) => r.orderId)).toEqual(['pg3', 'pg2']);
    const p2 = paginateSettlementTable(rows, 2, 2);
    expect(p2.rows.map((r) => r.orderId)).toEqual(['pg1']);
  });
});

describe('salesPagination', () => {
  it('defaults and clamps to the documented bounds', () => {
    expect(salesPagination({})).toEqual({ page: 1, pageSize: 20 });
    expect(salesPagination({ page: 0, pageSize: 500 })).toEqual({ page: 1, pageSize: 20 });
    expect(salesPagination({ page: 3, pageSize: 50 })).toEqual({ page: 3, pageSize: 50 });
  });
});

describe('orderLineNet (§2 single discount definition)', () => {
  it('allocates a flat discount proportionally across lines', () => {
    const { net } = orderLineNet({
      items: [
        { price: 500, quantity: 2, costSnapshot: null, costType: null },
        { price: 500, quantity: 2, costSnapshot: null, costType: null },
      ],
      discount: 200,
      discountType: 'flat',
      subtotal: 2000,
    });
    expect(net).toBe(1800);
  });
});
