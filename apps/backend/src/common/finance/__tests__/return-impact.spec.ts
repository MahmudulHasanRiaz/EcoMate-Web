import {
  computeReceivedReturnImpact,
  receivedReturnValue,
} from '../return-impact';

const at = (iso: string) => new Date(iso);
const range = { start: at('2026-10-01T00:00:00Z'), end: at('2026-10-31T23:59:59Z') };

const orderItems = [
  { productId: 'p1', variantId: null, price: 100, quantity: 2, costSnapshot: 40 },
  { productId: 'p2', variantId: 'v2', price: 50, quantity: 3, costSnapshot: null },
];

describe('computeReceivedReturnImpact', () => {
  it('deducts received item value and mirrors its COGS', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        {
          id: 'r1',
          status: 'RESTOCKED',
          receivedAt: at('2026-10-10T00:00:00Z'),
          items: [{ productId: 'p1', quantity: 1 }],
        },
      ],
    });
    expect(r).toEqual({
      events: 1,
      undatedEvents: 0,
      units: 1,
      value: 100,
      cogsReversal: 40,
      cogsUnavailableUnits: 0,
    });
  });

  it('deducts nothing for a return that was created but not received', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        {
          id: 'r1',
          status: 'REQUESTED',
          receivedAt: null,
          items: [{ productId: 'p1', quantity: 2 }],
        },
      ],
    });
    expect(r.value).toBe(0);
    expect(r.events).toBe(0);
    expect(r.cogsReversal).toBe(0);
  });

  it('counts an undated received return but deducts nothing (no invented date)', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        {
          id: 'r1',
          status: 'RECEIVED',
          receivedAt: null,
          items: [{ productId: 'p1', quantity: 1 }],
        },
      ],
    });
    expect(r.undatedEvents).toBe(1);
    expect(r.value).toBe(0);
  });

  it('never rewrites a prior period: receipt outside the range deducts nothing', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        {
          id: 'r1',
          status: 'RESTOCKED',
          receivedAt: at('2026-09-10T00:00:00Z'),
          items: [{ productId: 'p1', quantity: 1 }],
        },
      ],
    });
    expect(r.value).toBe(0);
    expect(r.events).toBe(0);
  });

  it('caps cumulative returned quantity at the ordered line quantity', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        {
          id: 'r1',
          status: 'RESTOCKED',
          receivedAt: at('2026-10-05T00:00:00Z'),
          items: [{ productId: 'p1', quantity: 2 }],
        },
        {
          id: 'r2',
          status: 'RESTOCKED',
          receivedAt: at('2026-10-06T00:00:00Z'),
          items: [{ productId: 'p1', quantity: 2 }],
        },
      ],
    });
    expect(r.value).toBe(200);
    expect(r.units).toBe(2);
  });

  it('matches a variant line and counts COGS-unavailable units honestly', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        {
          id: 'r1',
          status: 'RECEIVED',
          receivedAt: at('2026-10-11T00:00:00Z'),
          items: [{ productId: 'p2', variantId: 'v2', quantity: 2 }],
        },
      ],
    });
    expect(r.value).toBe(100);
    expect(r.cogsReversal).toBe(0);
    expect(r.cogsUnavailableUnits).toBe(2);
  });

  it('tolerates malformed items JSON', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        { id: 'r1', status: 'RESTOCKED', receivedAt: at('2026-10-11T00:00:00Z'), items: null },
        { id: 'r2', status: 'RESTOCKED', receivedAt: at('2026-10-11T00:00:00Z'), items: 'nope' },
      ],
    });
    expect(r.value).toBe(0);
    expect(r.events).toBe(0);
  });
});

describe('receivedReturnValue', () => {
  it('sums every received return regardless of date', () => {
    expect(
      receivedReturnValue({
        orderItems,
        returns: [
          {
            id: 'r1',
            status: 'RESTOCKED',
            receivedAt: at('2025-01-01T00:00:00Z'),
            items: [{ productId: 'p1', quantity: 1 }],
          },
          {
            id: 'r2',
            status: 'RECEIVED',
            receivedAt: null,
            items: [{ productId: 'p2', variantId: 'v2', quantity: 2 }],
          },
          {
            id: 'r3',
            status: 'REQUESTED',
            receivedAt: null,
            items: [{ productId: 'p1', quantity: 2 }],
          },
        ],
      }),
    ).toBe(200);
  });
});
