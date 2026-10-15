import { findDuplicateReturn } from '../return-guard';

/**
 * MED clock skew: 60s dup window must be computed in DB (now() - interval),
 * never from the app Date (which skews vs DB createdAt).
 * RED phase: with a skewed app `now`, the duplicate is missed until the fix.
 */
describe('findDuplicateReturn — DB-computed 60s window (MED clock skew)', () => {
  const line = (productId: string, quantity: number) => ({
    productId,
    variantId: null,
    quantity,
  });

  it('finds the duplicate even when the app clock is 10min ahead (DB time rules)', async () => {
    const dbNow = new Date('2026-01-01T00:00:00.000Z');
    const dupCreatedAt = new Date(dbNow.getTime() - 30_000); // 30s ago by DB time
    const dupRow: any = {
      id: 'ret-dup',
      displayId: 'RTN-260101-0005',
      orderId: 'order-1',
      type: 'PARTIAL',
      items: [line('prod-1', 1)],
      createdAt: dupCreatedAt,
    };
    const db: any = {
      // DB clock: NOW() - 60s window derived from DB, not the skewed app now.
      $queryRaw: jest.fn().mockResolvedValue([{ windowStart: new Date(dbNow.getTime() - 60_000) }]),
      return: {
        findMany: jest.fn().mockImplementation(async (args: any) => {
          // Record what window the code queried with.
          (db as any).__queriedGte = args?.where?.createdAt?.gte;
          return [dupRow];
        }),
      },
    };
    // App clock 10 minutes AHEAD of DB — old code windows from this and misses.
    const skewedAppNow = new Date(dbNow.getTime() + 10 * 60_000);

    const found = await findDuplicateReturn(db, 'order-1', 'PARTIAL', [line('prod-1', 1)], skewedAppNow);

    expect(found).not.toBeNull();
    expect((found as any)?.id).toBe('ret-dup');
    // The query window must come from DB time (≈ dbNow − 60s), NOT app time.
    const queriedGte = new Date((db as any).__queriedGte);
    expect(Math.abs(queriedGte.getTime() - (dbNow.getTime() - 60_000))).toBeLessThan(5_000);
  });
});
