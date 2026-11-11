import { StockRouterService } from '../stock-router.service';

/**
 * Q6 lifecycle, proven from ROUTER DECISIONS ALONE (2026-11-11).
 *
 * After the auto-mirror removal, nothing copies quantities between the
 * managed and physical layers behind the scenes — the order lifecycle
 * must hold purely from what StockRouterService decides per operation:
 *
 *   MANAGED_STOCK + IM on:
 *     create  → reserve managed only
 *     confirm → gate on REAL physical (check = physical) + allocate physical
 *     dispatch→ deduct BOTH layers
 *     return  → restore BOTH layers
 *
 *   INVENTORY_CONTROLLED + IM on (physical only, managed untouched —
 *   even when the product's syncManagedStock flag is true):
 *     create  → allocate physical only
 *     confirm → check physical
 *     dispatch→ fulfill physical only
 *     return  → add physical only
 */
describe('StockRouterService — Q6 lifecycle from decisions alone', () => {
  const router = new StockRouterService({} as any);
  const seq = (mode: string, ops: string[], sync?: boolean) =>
    ops.map((op) => {
      const d = router.resolve(mode, op, true, sync);
      return `${op}:${d.ms}/${d.pi}`;
    });

  it('MANAGED_STOCK + IM: reserve managed → confirm gates+allocates physical → dispatch deducts both → return restores both', () => {
    expect(
      seq('MANAGED_STOCK', ['reserve', 'check', 'allocate', 'deduct', 'add']),
    ).toEqual([
      'reserve:reserve/skip', // order create: managed hold only
      'check:skip/check', // confirm gate: REAL physical availability
      'allocate:skip/allocate', // confirm: physical allocation
      'deduct:deduct/fulfill', // dispatch (handed over): BOTH layers
      'add:add/add', // return: BOTH layers restored
    ]);
    // Cancel/edit releases both holds.
    expect(router.resolve('MANAGED_STOCK', 'release', true)).toEqual({
      ms: 'release',
      pi: 'release',
      msConditionalOnSync: false,
    });
  });

  it('MANAGED_STOCK + IM off: managed only at every step', () => {
    for (const op of ['reserve', 'release', 'deduct', 'add']) {
      const d = router.resolve('MANAGED_STOCK', op, false);
      expect(d.pi).toBe('skip');
      expect(d.ms).toBe(op);
    }
  });

  it('INVENTORY_CONTROLLED + IM: physical only at every step — managed untouched even with syncManagedStock=true', () => {
    expect(
      seq('INVENTORY_CONTROLLED', ['reserve', 'check', 'allocate', 'deduct', 'add', 'release'], true),
    ).toEqual([
      'reserve:skip/allocate',
      'check:skip/check',
      'allocate:skip/allocate',
      'deduct:skip/fulfill',
      'add:skip/add',
      'release:skip/release',
    ]);
    // And with the flag off the decisions are IDENTICAL (flag is inert).
    expect(
      seq('INVENTORY_CONTROLLED', ['reserve', 'check', 'allocate', 'deduct', 'add', 'release'], false),
    ).toEqual(
      seq('INVENTORY_CONTROLLED', ['reserve', 'check', 'allocate', 'deduct', 'add', 'release'], true),
    );
  });
});
