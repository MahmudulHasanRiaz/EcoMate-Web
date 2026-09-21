/**
 * P2 data-layer tests — P&L ladder + bridge (§2.5, §2.11, §7.1 costs/D10/D12).
 *
 * Pure computePnl() over fixtures (recognition via metric-contract, never
 * duplicated) + service fetch wiring (trashed excluded, filters in SQL).
 */
import { PaymentStatus } from '@prisma/client';
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

function deliveredAt(ts: string) {
  return [{ status: 'Delivered', timestamp: ts }];
}

function item(
  price: number,
  quantity: number,
  extra: Partial<PnlOrderInput['items'][number]> = {},
) {
  return {
    price,
    quantity,
    costSnapshot: 60,
    costType: 'actual' as const,
    ...extra,
  };
}

function baseOrder(extra: Partial<PnlOrderInput> = {}): PnlOrderInput {
  return {
    id: 'o1',
    total: 1000,
    subtotal: 1000,
    shippingCharge: 80,
    discount: 0,
    discountType: 'flat',
    status: 'Delivered',
    timeline: deliveredAt('2026-09-10T10:00:00+06:00'),
    paymentOptionType: 'FULL_PAYMENT',
    items: [item(500, 2)],
    payments: [],
    refunds: [],
    ...extra,
  };
}

function input(
  orders: PnlOrderInput[],
  extra: Partial<PnlInput> = {},
): PnlInput {
  return {
    range: RANGE,
    orders,
    bookedOrders: [],
    cashPayments: [],
    consumptions: [],
    expenses: [],
    ...extra,
  };
}

describe('computePnl — gross sales and discounts', () => {
  it('sums price×qty across multi-variant, multi-quantity lines', () => {
    const r = computePnl(
      input([
        baseOrder({
          items: [item(100, 3), item(250, 2, { costType: 'estimated' })],
        }),
      ]),
    );
    expect(r.grossSales.amount).toBe(800);
    expect(r.cogs.amount).toBe(60 * 3 + 60 * 2);
  });

  it('allocates flat discounts proportionally per contract', () => {
    const r = computePnl(
      input([baseOrder({ discount: 100, discountType: 'flat' })]),
    );
    expect(r.discounts.amount).toBe(100);
    expect(r.netSales.amount).toBe(r.grossSales.amount - 100);
  });

  it('derives percentage discounts from subtotal before allocation', () => {
    const r = computePnl(
      input([
        baseOrder({
          subtotal: 1000,
          discount: 10,
          discountType: 'percentage',
          items: [item(500, 2)],
        }),
      ]),
    );
    expect(r.discounts.amount).toBe(100);
  });

  it('never puts shippingCharge inside Gross Sales (F10)', () => {
    const r = computePnl(
      input([baseOrder({ shippingCharge: 5000, items: [item(500, 2)] })]),
    );
    expect(r.grossSales.amount).toBe(1000);
  });

  it('ignores pre-delivery orders for revenue (D4)', () => {
    const r = computePnl(
      input([
        baseOrder({
          id: 'o2',
          status: 'Confirmed',
          timeline: [{ status: 'Confirmed', timestamp: '2026-09-10T10:00:00+06:00' }],
          items: [item(999, 9)],
        }),
      ]),
    );
    expect(r.grossSales.amount).toBe(0);
    expect(r.recognisedOrders).toBe(0);
  });

  it('dates revenue at the Delivered transition, not createdAt', () => {
    const inRange = computePnl(
      input([
        baseOrder({ timeline: deliveredAt('2026-09-05T10:00:00+06:00') }),
      ]),
    );
    expect(inRange.recognisedOrders).toBe(1);
    const outOfRange = computePnl(
      input([
        baseOrder({ timeline: deliveredAt('2026-08-05T10:00:00+06:00') }),
      ]),
    );
    expect(outOfRange.recognisedOrders).toBe(0);
    expect(outOfRange.grossSales.amount).toBe(0);
  });
});

describe('computePnl — returns and refunds (D7)', () => {
  const returnedTimeline = [
    { status: 'Delivered', timestamp: '2026-09-05T10:00:00+06:00' },
    { status: 'Returned', timestamp: '2026-09-20T10:00:00+06:00' },
  ];

  it('reverses delivered-then-returned at the return event date', () => {
    const r = computePnl(input([baseOrder({ timeline: returnedTimeline })]));
    expect(r.returns.amount).toBe(1000);
    expect(r.returnedCogs.amount).toBe(120);
  });

  it('takes no reversal for return-before-delivery (F9)', () => {
    const r = computePnl(
      input([
        baseOrder({
          status: 'Returned',
          timeline: [
            { status: 'Shipping', timestamp: '2026-09-05T10:00:00+06:00' },
            { status: 'Returned', timestamp: '2026-09-20T10:00:00+06:00' },
          ],
        }),
      ]),
    );
    expect(r.returns.amount).toBe(0);
    expect(r.grossSales.amount).toBe(0);
  });

  it('treats refund on delivered non-returned as the single reversal', () => {
    const r = computePnl(
      input([
        baseOrder({
          refunds: [
            {
              amount: 200,
              status: 'completed',
              processedAt: D('2026-09-21T10:00:00+06:00'),
              createdAt: D('2026-09-21T10:00:00+06:00'),
            },
          ],
        }),
      ]),
    );
    expect(r.refundsReversal.amount).toBe(200);
    expect(r.informationalRefunds).toBe(0);
  });

  it('keeps refund on delivered+returned informational (no double reversal)', () => {
    const r = computePnl(
      input([
        baseOrder({
          timeline: returnedTimeline,
          refunds: [
            {
              amount: 1000,
              status: 'completed',
              processedAt: D('2026-09-22T10:00:00+06:00'),
              createdAt: D('2026-09-22T10:00:00+06:00'),
            },
          ],
        }),
      ]),
    );
    expect(r.returns.amount).toBe(1000);
    expect(r.refundsReversal.amount).toBe(0);
    expect(r.informationalRefunds).toBe(1000);
  });

  it('ignores refunds on never-delivered orders in the ladder', () => {
    const r = computePnl(
      input([
        baseOrder({
          status: 'Cancelled',
          timeline: [{ status: 'Cancelled', timestamp: '2026-09-10T10:00:00+06:00' }],
          refunds: [
            {
              amount: 300,
              status: 'completed',
              processedAt: D('2026-09-21T10:00:00+06:00'),
              createdAt: D('2026-09-21T10:00:00+06:00'),
            },
          ],
        }),
      ]),
    );
    expect(r.refundsReversal.amount).toBe(0);
  });

  it('counts never-delivered refunds in Total Refunds (informational)', () => {
    const r = computePnl(
      input([
        baseOrder({
          status: 'Cancelled',
          timeline: [{ status: 'Cancelled', timestamp: '2026-09-10T10:00:00+06:00' }],
          refunds: [
            {
              amount: 300,
              status: 'completed',
              processedAt: D('2026-09-21T10:00:00+06:00'),
              createdAt: D('2026-09-21T10:00:00+06:00'),
            },
          ],
        }),
      ]),
    );
    expect(r.refundsReversal.amount).toBe(0);
    expect(r.informationalRefunds).toBe(300);
  });

  it('keeps cross-period returns out of the delivery period (no rewrite)', () => {
    const deliveredAugReturnedSep = baseOrder({
      timeline: [
        { status: 'Delivered', timestamp: '2026-08-05T10:00:00+06:00' },
        { status: 'Returned', timestamp: '2026-09-20T10:00:00+06:00' },
      ],
    });
    const sep = computePnl(input([deliveredAugReturnedSep]));
    expect(sep.grossSales.amount).toBe(0);
    expect(sep.returns.amount).toBe(1000);
  });
});

describe('computePnl — COGS states (never standardCost)', () => {
  it('splits actual / estimated / unavailable with coverage', () => {
    const r = computePnl(
      input([
        baseOrder({
          items: [
            item(100, 1, { costSnapshot: 40, costType: 'actual' }),
            item(100, 2, { costSnapshot: 50, costType: 'estimated' }),
            item(100, 3, { costSnapshot: null, costType: null }),
          ],
        }),
      ]),
    );
    expect(r.cogs.amount).toBe(40 + 100);
    expect(r.cogs.state).toBe('unavailable');
    expect(r.coverage.cogs.unavailableUnits).toBe(3);
    expect(r.coverage.cogs.actualPct).toBeCloseTo(100 / 6, 5);
  });

  it('never back-fills from current standardCost', () => {
    const r = computePnl(
      input([
        baseOrder({
          items: [
            item(100, 2, {
              costSnapshot: null,
              costType: null,
              standardCost: 5,
            } as any),
          ],
        }),
      ]),
    );
    expect(r.cogs.amount).toBe(0);
    expect(r.cogs.state).toBe('unavailable');
  });

  it('marks all-actual COGS actual with zero unavailable units', () => {
    const r = computePnl(input([baseOrder()]));
    expect(r.cogs.state).toBe('actual');
    expect(r.coverage.cogs.unavailableUnits).toBe(0);
  });
});

describe('computePnl — fulfillment, fees, marketing (D10)', () => {
  it('resolves manual / courier_default / missing fulfillment states', () => {
    const r = computePnl(
      input([
        baseOrder({ id: 'a', shippingCost: 60, shippingCostSource: 'manual' }),
        baseOrder({
          id: 'b',
          shippingCost: 70,
          shippingCostSource: 'courier_default',
        }),
        baseOrder({ id: 'c', shippingCost: null, shippingCostSource: null }),
      ]),
    );
    expect(r.fulfillmentCost.amount).toBe(130);
    expect(r.fulfillmentCost.state).toBe('unavailable');
    expect(r.coverage.shipping).toMatchObject({
      actualOrders: 1,
      estimatedOrders: 1,
      unavailableOrders: 1,
    });
  });

  it('counts zero manual cost as actual zero (not missing)', () => {
    const r = computePnl(
      input([baseOrder({ shippingCost: 0, shippingCostSource: 'manual' })]),
    );
    expect(r.fulfillmentCost.amount).toBe(0);
    expect(r.fulfillmentCost.state).toBe('actual');
  });

  it('counts each PAID payment fee once; PAID→FAILED drops it', () => {
    const order = baseOrder({
      payments: [
        {
          amount: 600,
          status: PaymentStatus.PAID,
          gatewayCode: 'bkash',
          feeAmount: 12,
          createdAt: D('2026-09-11T10:00:00+06:00'),
        },
        {
          amount: 400,
          status: PaymentStatus.PAID,
          gatewayCode: 'nagad',
          feeAmount: 8,
          createdAt: D('2026-09-12T10:00:00+06:00'),
        },
        {
          amount: 400,
          status: PaymentStatus.FAILED,
          gatewayCode: 'nagad',
          feeAmount: 8,
          createdAt: D('2026-09-13T10:00:00+06:00'),
        },
      ],
    });
    const r = computePnl(input([order]));
    expect(r.paymentFees.amount).toBe(20);
    expect(r.coverage.fees).toMatchObject({
      paidPayments: 2,
      withFee: 2,
      withoutFee: 0,
    });
  });

  it('flags missing fees as unavailable without zero-filling', () => {
    const r = computePnl(
      input([
        baseOrder({
          payments: [
            {
              amount: 1000,
              status: PaymentStatus.PAID,
              gatewayCode: 'bkash',
              feeAmount: null,
              createdAt: D('2026-09-11T10:00:00+06:00'),
            },
          ],
        }),
      ]),
    );
    expect(r.paymentFees.amount).toBe(0);
    expect(r.paymentFees.state).toBe('unavailable');
    expect(r.coverage.fees.withoutFee).toBe(1);
  });

  it('sums dated marketing cost only; NULL spendDate is excluded + unavailable', () => {
    const r = computePnl(
      input([baseOrder()], {
        consumptions: [
          { calculatedCost: 500, spendDate: D('2026-09-10T00:00:00Z') },
          { calculatedCost: 300, spendDate: null },
        ],
      }),
    );
    expect(r.marketingCost.amount).toBe(500);
    expect(r.marketingCost.state).toBe('unavailable');
    expect(r.coverage.marketing).toMatchObject({
      datedRows: 1,
      undatedRows: 1,
      datedAmount: 500,
      undatedAmount: 300,
    });
  });

  it('never uses allocatedAt as a financial date', () => {
    const r = computePnl(
      input([baseOrder()], {
        consumptions: [
          {
            calculatedCost: 999,
            spendDate: null,
            allocatedAt: D('2026-09-10T00:00:00Z'),
          } as any,
        ],
      }),
    );
    expect(r.marketingCost.amount).toBe(0);
    expect(r.coverage.marketing.undatedAmount).toBe(999);
  });

  it('sums operating expenses by expenseDate with tax', () => {
    const r = computePnl(
      input([baseOrder()], {
        expenses: [
          {
            amount: 1000,
            taxAmount: 150,
            expenseDate: D('2026-09-10T00:00:00Z'),
          },
          { amount: 500, taxAmount: 0, expenseDate: D('2026-08-10T00:00:00Z') },
        ],
      }),
    );
    expect(r.operatingExpenses.amount).toBe(1150);
  });
});

describe('computePnl — bridge (D12)', () => {
  function profitable() {
    return computePnl(
      input([baseOrder({ shippingCost: 60, shippingCostSource: 'manual' })], {
        consumptions: [
          { calculatedCost: 100, spendDate: D('2026-09-10T00:00:00Z') },
        ],
        expenses: [
          { amount: 50, taxAmount: 0, expenseDate: D('2026-09-10T00:00:00Z') },
        ],
      }),
    );
  }

  it('holds TBC == CP + DCR with the component-once ledger', () => {
    const r = profitable();
    expect(r.bridge.totalBusinessContribution).toBe(
      r.contributionProfit.amount + r.bridge.deliveryChargeRetained,
    );
    expect(r.bridge.netProfit).toBe(
      r.bridge.totalBusinessContribution - r.operatingExpenses.amount,
    );
    expect(r.netProfit.amount).toBe(r.bridge.netProfit);
    expect(r.operatingProfit.amount).toBe(r.bridge.netProfit);
  });

  it('matches the restated form (NS−COGS−PF−MK) + FM', () => {
    const r = profitable();
    const restated =
      r.netSales.amount -
      r.cogs.amount -
      r.paymentFees.amount -
      r.marketingCost.amount +
      r.bridge.fulfillmentMargin;
    expect(restated).toBeCloseTo(r.bridge.totalBusinessContribution, 5);
  });

  it('marks DCR unavailable when recognised COD orders exist (D11)', () => {
    const r = computePnl(
      input([
        baseOrder({
          paymentOptionType: 'CASH_ON_DELIVERY',
          shippingCost: 60,
          shippingCostSource: 'manual',
        }),
      ]),
    );
    expect(r.bridge.deliveryChargeRetainedState).toBe('unavailable');
    expect(r.bridge.codRecognisedOrders).toBe(1);
  });

  it('renders Other Costs not_applicable (null, never zero)', () => {
    const r = profitable();
    expect(r.otherCosts.value).toBeNull();
    expect(r.otherCosts.state).toBe('not_applicable');
  });

  it('returns null margins when Net Sales <= 0', () => {
    const r = computePnl(input([]));
    expect(r.margins.net).toBeNull();
    expect(r.margins.gross).toBeNull();
  });
});

describe('computePnl — lenses and recognition strip', () => {
  it('reports L1 booked, L2 recognised and L3 cash side by side', () => {
    const r = computePnl(
      input([baseOrder()], {
        bookedOrders: [
          { createdAt: D('2026-09-05T10:00:00+06:00'), total: 1000 },
          { createdAt: D('2026-09-06T10:00:00+06:00'), total: 500 },
        ],
        cashPayments: [
          {
            amount: 1000,
            status: PaymentStatus.PAID,
            gatewayCode: 'bkash',
            createdAt: D('2026-09-11T10:00:00+06:00'),
          },
        ],
      }),
    );
    expect(r.lenses.booked).toBe(1500);
    expect(r.lenses.recognised).toBe(r.netSales.amount);
    expect(r.lenses.cashCollected).toBe(1000);
  });

  it('exposes undated deliveries and the date-source mix', () => {
    const r = computePnl(
      input([
        baseOrder(),
        baseOrder({
          id: 'o2',
          status: 'Delivered',
          timeline: [],
          dispatchDeliveredAt: D('2026-09-12T10:00:00+06:00'),
        }),
        baseOrder({
          id: 'o3',
          status: 'Delivered',
          timeline: [{ status: 'Delivered', timestamp: 'not-a-date' }],
        }),
      ]),
    );
    expect(r.strip.dateSourceMix).toMatchObject({ timeline: 1, dispatch: 1 });
    expect(r.strip.undatedDeliveries).toBe(1);
    expect(r.recognisedOrders).toBe(2);
  });
});
