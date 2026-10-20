/**
 * P&L §1/§3/§5 — item-level received returns, partial-delivery kept-items
 * recognition, and COD delivery-charge retained from actual settlement data.
 * Guard cases: unreceived, prior-period, full reversal (R12), partial.
 */
import {
  computePnl,
  type PnlInput,
  type PnlOrderInput,
} from '../analytics-pnl.service';

const RANGE = {
  start: new Date('2026-09-01T00:00:00+06:00'),
  end: new Date('2026-09-30T17:59:59.999Z'),
};

const D = (s: string) => new Date(s);

const received = (quantity: number, at = '2026-09-15T10:00:00+06:00', status = 'RESTOCKED') => ({
  id: `ret-${quantity}-${at}`,
  status,
  receivedAt: D(at),
  items: [{ productId: 'p1', quantity }],
});

function baseOrder(extra: Partial<PnlOrderInput> = {}): PnlOrderInput {
  return {
    id: 'o1',
    total: 1000,
    subtotal: 1000,
    shippingCharge: 80,
    discount: 0,
    discountType: 'flat',
    status: 'Delivered',
    timeline: [{ status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' }],
    paymentOptionType: 'FULL_PAYMENT',
    items: [
      {
        productId: 'p1',
        variantId: null,
        price: 500,
        quantity: 2,
        costSnapshot: 60,
        costType: 'actual' as const,
      },
    ],
    payments: [],
    refunds: [],
    ...extra,
  };
}

const input = (orders: PnlOrderInput[], extra: Partial<PnlInput> = {}): PnlInput => ({
  range: RANGE,
  orders,
  bookedOrders: [],
  cashPayments: [],
  consumptions: [],
  expenses: [],
  ...extra,
});

describe('computePnl — received partial returns', () => {
  it('deducts the received item value and reverses its COGS', () => {
    const r = computePnl(input([baseOrder({ receivedReturns: [received(1)] })]));
    expect(r.returns.amount).toBe(500);
    expect(r.returns.receivedAmount).toBe(500);
    expect(r.returnReceivedEvents).toBe(1);
    expect(r.netSales.amount).toBe(500);
    expect(r.returnedCogs.amount).toBe(60);
    expect(r.cogs.amount).toBe(60);
    expect(r.grossProfit.amount).toBe(440);
  });

  it('deducts nothing for a created-but-not-received return', () => {
    const r = computePnl(
      input([
        baseOrder({
          receivedReturns: [received(1, '2026-09-15T10:00:00+06:00', 'REQUESTED')],
        }),
      ]),
    );
    expect(r.returns.amount).toBe(0);
    expect(r.netSales.amount).toBe(1000);
  });

  it('never rewrites a prior period (receipt outside the range)', () => {
    const r = computePnl(
      input([baseOrder({ receivedReturns: [received(1, '2026-08-15T10:00:00+06:00')] })]),
    );
    expect(r.returns.amount).toBe(0);
  });

  it('does not double-deduct when the whole order was reversed (R12)', () => {
    const r = computePnl(
      input([
        baseOrder({
          status: 'Returned',
          timeline: [
            { status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' },
            { status: 'Returned', timestamp: '2026-09-20T10:00:00+06:00' },
          ],
          receivedReturns: [received(1, '2026-09-20T10:00:00+06:00')],
        }),
      ]),
    );
    expect(r.returns.amount).toBe(1000);
    expect(r.returns.receivedAmount).toBe(0);
    expect(r.returnEvents).toBe(1);
    expect(r.returnedCogs.amount).toBe(120);
  });

  it('counts an undated received return but invents no period deduction', () => {
    const r = computePnl(
      input([baseOrder({ receivedReturns: [received(1, '2026-09-15T10:00:00+06:00')] })]),
    );
    expect(r.returnReceivedEvents).toBe(1);
    const r2 = computePnl(
      input([
        baseOrder({
          receivedReturns: [
            { id: 'u1', status: 'RECEIVED', receivedAt: null, items: [{ productId: 'p1', quantity: 1 }] },
          ],
        }),
      ]),
    );
    expect(r2.returnReceivedUndatedEvents).toBe(1);
    expect(r2.returns.amount).toBe(0);
    expect(r.returns.amount).toBe(500);
  });
});

describe('computePnl — damaged units', () => {
  const damaged = (
    damagedQuantity: number,
    phase: 'receive' | 'later',
    damageAt = '2026-09-15T12:00:00+06:00',
    quantity = 2,
  ) => ({
    id: `dmg-${phase}-${damagedQuantity}`,
    status: 'RESTOCKED',
    receivedAt: D('2026-09-15T10:00:00+06:00'),
    items: [
      {
        productId: 'p1',
        quantity,
        damagedQuantity,
        damageLog: [{ qty: damagedQuantity, at: D(damageAt), phase }],
      },
    ],
  });

  it('deducts revenue for damaged units but reverses COGS for good units only', () => {
    const r = computePnl(input([baseOrder({ receivedReturns: [damaged(1, 'receive')] })]));
    expect(r.returns.amount).toBe(1000);
    expect(r.returnedCogs.amount).toBe(60);
    expect(r.damagedCogs.amount).toBe(0);
    expect(r.cogs.amount).toBe(60);
  });

  it('re-expenses later damage at its own date (same period)', () => {
    const r = computePnl(
      input([baseOrder({ receivedReturns: [damaged(1, 'later', '2026-09-25T12:00:00+06:00')] })]),
    );
    expect(r.returnedCogs.amount).toBe(120);
    expect(r.damagedCogs.amount).toBe(60);
    expect(r.cogs.amount).toBe(60);
  });

  it('re-expenses later damage in the damage period even when the receipt is older', () => {
    const october = {
      start: new Date('2026-10-01T00:00:00+06:00'),
      end: new Date('2026-10-31T23:59:59+06:00'),
    };
    const r = computePnl(
      input(
        [
          baseOrder({
            receivedReturns: [
              damaged(1, 'later', '2026-10-25T12:00:00+06:00', 2),
            ],
          }),
        ],
        { range: october },
      ),
    );
    // Revenue/COGS reversal belong to September; only the damage loss lands here.
    expect(r.recognisedOrders).toBe(0);
    expect(r.returnedCogs.amount).toBe(0);
    expect(r.damagedCogs.amount).toBe(60);
    expect(r.cogs.amount).toBe(60);
  });

  it('keeps the receive-damaged cost as a loss on a partial order', () => {
    const order = baseOrder({
      status: 'Partial',
      timeline: [
        { status: 'Out for Delivery', timestamp: '2026-09-18T10:00:00+06:00' },
        { status: 'Partial', timestamp: '2026-09-20T10:00:00+06:00' },
      ],
      items: [
        {
          productId: 'p1',
          variantId: null,
          price: 500,
          quantity: 3,
          costSnapshot: 60,
          costType: 'actual' as const,
        },
      ],
      receivedReturns: [
        {
          id: 'partial-dmg',
          status: 'RESTOCKED',
          receivedAt: D('2026-09-22T10:00:00+06:00'),
          items: [
            {
              productId: 'p1',
              quantity: 1,
              damagedQuantity: 1,
              damageLog: [{ qty: 1, at: D('2026-09-22T10:00:00+06:00'), phase: 'receive' }],
            },
          ],
        },
      ],
    });
    const r = computePnl(input([order]));
    // Kept 2 units: COGS 120. The returned damaged unit never restocked → +60 loss.
    expect(r.cogs.amount).toBe(180);
    expect(r.damagedCogs.amount).toBe(60);
  });
});

describe('computePnl — partial-delivery kept-items recognition', () => {
  const partialOrder = (extra: Partial<PnlOrderInput> = {}) =>
    baseOrder({
      status: 'Partial',
      timeline: [
        { status: 'Out for Delivery', timestamp: '2026-09-18T10:00:00+06:00' },
        { status: 'Partial', timestamp: '2026-09-20T10:00:00+06:00' },
      ],
      items: [
        {
          productId: 'p1',
          variantId: null,
          price: 500,
          quantity: 3,
          costSnapshot: 60,
          costType: 'actual' as const,
        },
      ],
      ...extra,
    });

  it('recognises kept items only (received return excluded), COGS mirror', () => {
    const r = computePnl(input([partialOrder({ receivedReturns: [received(1)] })]));
    expect(r.recognisedOrders).toBe(1);
    expect(r.partialRecognition.orders).toBe(1);
    expect(r.grossSales.amount).toBe(1000);
    expect(r.netSales.amount).toBe(1000);
    expect(r.cogs.amount).toBe(120);
    expect(r.returns.amount).toBe(0);
    expect(r.returns.partialAmount).toBe(500);
  });

  it('apportions the order discount to the kept share only', () => {
    const r = computePnl(
      input([
        partialOrder({
          discount: 300,
          discountType: 'flat',
          receivedReturns: [received(1)],
        }),
      ]),
    );
    // Original allocation: 1500 − 300 = 1200. Kept 2 of 3 on the single line.
    expect(r.grossSales.amount).toBe(1000);
    expect(r.discounts.amount).toBe(200);
    expect(r.netSales.amount).toBe(800);
  });

  it('stays unrecognised when the Partial transition has no usable date', () => {
    const r = computePnl(
      input([
        partialOrder({
          timeline: [{ status: 'Partial', timestamp: 'not-a-date' }],
          receivedReturns: [received(1)],
        }),
      ]),
    );
    expect(r.recognisedOrders).toBe(0);
    expect(r.grossSales.amount).toBe(0);
    expect(r.netSales.amount).toBe(0);
  });

  it('does not item-deduct received returns on top of kept recognition', () => {
    const r = computePnl(input([partialOrder({ receivedReturns: [received(2)] })]));
    expect(r.grossSales.amount).toBe(500);
    expect(r.returns.amount).toBe(0);
    expect(r.netSales.amount).toBe(500);
  });
});

describe('computePnl — exchange composition', () => {
  it('deducts from the original order while the exchange order recognises normally', () => {
    const original = baseOrder({ id: 'orig', receivedReturns: [received(1)] });
    const exchange = baseOrder({ id: 'exch' });
    const r = computePnl(input([original, exchange]));
    expect(r.recognisedOrders).toBe(2);
    expect(r.grossSales.amount).toBe(2000);
    expect(r.returns.amount).toBe(500);
    expect(r.netSales.amount).toBe(1500);
  });
});

describe('computePnl — COD delivery charge retained (§5)', () => {
  it('adds actual settlement DCR while courier cost stays deducted once', () => {
    const r = computePnl(
      input([
        baseOrder({
          paymentOptionType: 'CASH_ON_DELIVERY',
          shippingCost: 80,
          codCollection: {
            state: 'actual',
            amountCollected: 1000,
            amountRetained: 920,
            deliveryChargeRetained: 80,
            fulfillmentMargin: -40,
          },
        }),
      ]),
    );
    expect(r.bridge.deliveryChargeRetained).toBe(80);
    expect(r.bridge.deliveryChargeRetainedState).toBe('actual');
    expect(r.bridge.codSettledOrders).toBe(1);
    expect(r.bridge.codUnsettledOrders).toBe(0);
    expect(r.fulfillmentCost.amount).toBe(80);
  });

  it('never guesses: missing settlement keeps DCR unavailable and excluded', () => {
    const r = computePnl(
      input([baseOrder({ paymentOptionType: 'CASH_ON_DELIVERY', codCollection: null })]),
    );
    expect(r.bridge.deliveryChargeRetained).toBe(0);
    expect(r.bridge.deliveryChargeRetainedState).toBe('unavailable');
    expect(r.bridge.codUnsettledOrders).toBe(1);
    expect(r.bridge.excludedCodShippingCharge).toBe(80);
    expect(r.coverage.delivery.collectionUnavailableOrders).toBe(1);
  });

  it('keeps the aggregate unavailable when one COD order lacks settlement', () => {
    const r = computePnl(
      input([
        baseOrder({
          id: 'a',
          paymentOptionType: 'CASH_ON_DELIVERY',
          shippingCost: 80,
          codCollection: {
            state: 'actual',
            amountCollected: 1000,
            amountRetained: 920,
            deliveryChargeRetained: 80,
            fulfillmentMargin: -40,
          },
        }),
        baseOrder({ id: 'b', paymentOptionType: 'CASH_ON_DELIVERY', codCollection: null }),
      ]),
    );
    expect(r.bridge.deliveryChargeRetained).toBe(80);
    expect(r.bridge.deliveryChargeRetainedState).toBe('unavailable');
    expect(r.bridge.codSettledOrders).toBe(1);
    expect(r.bridge.codUnsettledOrders).toBe(1);
  });
});
