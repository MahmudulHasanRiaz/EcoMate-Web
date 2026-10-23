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
      receiveDamagedUnits: 0,
      receiveDamageCost: 0,
      receiveDamageUnavailableUnits: 0,
      laterDamageUnits: 0,
      laterDamageExpense: 0,
      laterDamageUnavailableUnits: 0,
      laterDamageEvents: 0,
    });
  });

  it('customized line: value includes the per-unit add-on share and the frozen add-on cost reverses even without a costSnapshot (Q15)', () => {
    const r = computeReceivedReturnImpact({
      orderItems: [
        {
          productId: 'p9', variantId: null, price: 700, quantity: 2,
          costSnapshot: null, addonAmount: 320, addonCostAmount: 110,
        },
      ],
      range,
      returns: [
        {
          id: 'r9',
          status: 'RECEIVED',
          receivedAt: at('2026-10-10T00:00:00Z'),
          items: [{ productId: 'p9', quantity: 1 }],
        },
      ],
    });
    // 1 of 2 units: value = 700 + 320/2; cogs reversal = 110/2 (add-on only).
    expect(r.value).toBe(860);
    expect(r.cogsReversal).toBe(55);
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

describe('computeReceivedReturnImpact — damaged units', () => {
  const damagedReturn = (input: {
    quantity: number
    damagedQuantity: number
    damageLog: Array<{ qty: number; at: string; phase: 'receive' | 'later'; by?: string }>
    receivedAt?: string
  }) => ({
    id: 'rd',
    status: 'RESTOCKED',
    receivedAt: at(input.receivedAt ?? '2026-10-10T00:00:00Z'),
    items: [
      {
        productId: 'p1',
        quantity: input.quantity,
        damagedQuantity: input.damagedQuantity,
        damageLog: input.damageLog,
      },
    ],
  });

  it('deducts revenue for every received unit but reverses COGS for good units only', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        damagedReturn({
          quantity: 2,
          damagedQuantity: 1,
          damageLog: [{ qty: 1, at: '2026-10-10T00:00:00Z', phase: 'receive' }],
        }),
      ],
    });
    expect(r.value).toBe(200);
    expect(r.cogsReversal).toBe(40);
    expect(r.receiveDamageCost).toBe(40);
    expect(r.receiveDamagedUnits).toBe(1);
  });

  it('all-damaged receive restores nothing and keeps the whole cost as a loss', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        damagedReturn({
          quantity: 2,
          damagedQuantity: 2,
          damageLog: [{ qty: 2, at: '2026-10-10T00:00:00Z', phase: 'receive' }],
        }),
      ],
    });
    expect(r.value).toBe(200);
    expect(r.cogsReversal).toBe(0);
    expect(r.receiveDamageCost).toBe(80);
  });

  it('re-expenses later damage at its own date, never rewriting the receive period', () => {
    const oct = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        damagedReturn({
          quantity: 2,
          damagedQuantity: 1,
          damageLog: [{ qty: 1, at: '2026-11-05T00:00:00Z', phase: 'later' }],
        }),
      ],
    });
    // Receive period: all units were restocked that day.
    expect(oct.cogsReversal).toBe(80);
    expect(oct.laterDamageExpense).toBe(0);

    const nov = computeReceivedReturnImpact({
      orderItems,
      range: { start: at('2026-11-01T00:00:00Z'), end: at('2026-11-30T23:59:59Z') },
      returns: [
        damagedReturn({
          quantity: 2,
          damagedQuantity: 1,
          damageLog: [{ qty: 1, at: '2026-11-05T00:00:00Z', phase: 'later' }],
        }),
      ],
    });
    expect(nov.cogsReversal).toBe(0);
    expect(nov.laterDamageExpense).toBe(40);
    expect(nov.laterDamageUnits).toBe(1);
    expect(nov.laterDamageEvents).toBe(1);
  });

  it('counts cost-unavailable units honestly, separated by damage phase', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        {
          id: 'r-null-cost',
          status: 'RESTOCKED',
          receivedAt: at('2026-10-10T00:00:00Z'),
          items: [
            {
              productId: 'p2',
              variantId: 'v2',
              quantity: 3,
              damagedQuantity: 1,
              damageLog: [{ qty: 1, at: '2026-10-10T00:00:00Z', phase: 'receive' }],
            },
          ],
        },
      ],
    });
    expect(r.cogsUnavailableUnits).toBe(2);
    expect(r.receiveDamageUnavailableUnits).toBe(1);
    expect(r.cogsReversal).toBe(0);
    expect(r.receiveDamageCost).toBe(0);
  });

  it('caps later-damage quantities at the received line quantity', () => {
    const r = computeReceivedReturnImpact({
      orderItems,
      range,
      returns: [
        damagedReturn({
          quantity: 1,
          damagedQuantity: 3,
          damageLog: [{ qty: 3, at: '2026-10-15T00:00:00Z', phase: 'later' }],
        }),
      ],
    });
    expect(r.laterDamageUnits).toBe(1);
    expect(r.laterDamageExpense).toBe(40);
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
