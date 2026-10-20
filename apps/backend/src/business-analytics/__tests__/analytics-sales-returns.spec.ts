/**
 * Sales §2.2 returns breakdown — received partial returns join the Returns
 * line; unreceived/prior-period/whole-reversed returns never double count.
 */
import {
  computeReturnBreakdown,
  type SalesOrderInput,
} from '../analytics-sales.service';

const RANGE = {
  start: new Date('2026-09-01T00:00:00+06:00'),
  end: new Date('2026-09-30T17:59:59.999Z'),
};

const rec = (
  quantity: number,
  at: string | null = '2026-09-15T10:00:00+06:00',
  status = 'RESTOCKED',
) => ({
  id: `ret-${quantity}-${at ?? 'undated'}`,
  status,
  receivedAt: at ? new Date(at) : null,
  items: [{ productId: 'p1', quantity }],
});

function order(extra: Partial<SalesOrderInput> = {}): SalesOrderInput {
  return {
    id: 'o1',
    displayId: 'ORD-260910-0001',
    total: 1000,
    subtotal: 1000,
    shippingCharge: 0,
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

describe('computeReturnBreakdown — received partial returns', () => {
  it('adds the received item value and COGS reversal to the Returns line', () => {
    const r = computeReturnBreakdown([order({ receivedReturns: [rec(1)] })], RANGE, 1);
    expect(r.value).toBe(500);
    expect(r.units).toBe(1);
    expect(r.cogsReversal).toBe(60);
    expect(r.receivedValue).toBe(500);
    expect(r.receivedCogsReversal).toBe(60);
    expect(r.receivedEvents).toBe(1);
    expect(r.events).toBe(0);
  });

  it('ignores created-but-not-received returns', () => {
    const r = computeReturnBreakdown(
      [order({ receivedReturns: [rec(1, null, 'REQUESTED')] })],
      RANGE,
      1,
    );
    expect(r.value).toBe(0);
    expect(r.receivedValue).toBe(0);
  });

  it('never counts a receipt outside the selected range', () => {
    const r = computeReturnBreakdown(
      [order({ receivedReturns: [rec(1, '2026-08-15T10:00:00+06:00')] })],
      RANGE,
      1,
    );
    expect(r.value).toBe(0);
  });

  it('does not add item-level value when the whole order was reversed (R12)', () => {
    const r = computeReturnBreakdown(
      [
        order({
          status: 'Returned',
          timeline: [
            { status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' },
            { status: 'Returned', timestamp: '2026-09-20T10:00:00+06:00' },
          ],
          receivedReturns: [rec(1, '2026-09-20T10:00:00+06:00')],
        }),
      ],
      RANGE,
      1,
    );
    expect(r.value).toBe(1000);
    expect(r.receivedValue).toBe(0);
    expect(r.events).toBe(1);
    expect(r.cogsReversal).toBe(120);
  });

  it('reports undated received returns without inventing a period deduction', () => {
    const r = computeReturnBreakdown(
      [order({ receivedReturns: [rec(1, null)] })],
      RANGE,
      1,
    );
    expect(r.value).toBe(0);
    expect(r.receivedUndatedEvents).toBe(1);
  });
});
