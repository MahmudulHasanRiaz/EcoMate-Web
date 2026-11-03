import { StockRouterService } from '../stock-router.service';

/**
 * syncManagedStock routing (inventory audit fix round, WS1 item 9).
 *
 * The flag is merchant-settable through the product DTO. For an
 * INVENTORY_CONTROLLED product with IM on, opting in makes the managed
 * counters MIRROR the physical legs; without the flag the managed side is
 * untouched, exactly as before. MANAGED_STOCK routing never changes.
 */
describe('StockRouterService — syncManagedStock', () => {
  const router = new StockRouterService({} as any);

  describe('INVENTORY_CONTROLLED + IM on, sync OFF (legacy behaviour)', () => {
    it.each([
      ['reserve', 'skip', 'allocate'],
      ['release', 'skip', 'release'],
      ['deduct', 'skip', 'fulfill'],
      ['add', 'skip', 'add'],
      ['allocate', 'skip', 'allocate'],
      ['check', 'skip', 'check'],
      ['scrap', 'skip', 'skip'],
    ])('%s → ms=%s pi=%s', (op, ms, pi) => {
      const d = router.resolve('INVENTORY_CONTROLLED', op, true, false);
      expect(d.ms).toBe(ms);
      expect(d.pi).toBe(pi);
      expect(d.msConditionalOnSync).toBe(false);
    });

    it('treats an undefined flag as OFF', () => {
      const d = router.resolve('INVENTORY_CONTROLLED', 'deduct', true, undefined);
      expect(d.ms).toBe('skip');
      expect(d.pi).toBe('fulfill');
    });
  });

  describe('INVENTORY_CONTROLLED + IM on, sync ON (managed mirrors physical)', () => {
    it.each([
      ['reserve', 'reserve', 'allocate'],
      ['release', 'release', 'release'],
      ['deduct', 'deduct', 'fulfill'],
      ['add', 'add', 'add'],
      // No managed leg at allocate: the hold was already placed at reserve.
      ['allocate', 'skip', 'allocate'],
      ['check', 'skip', 'check'],
      ['scrap', 'scrap', 'skip'],
    ])('%s → ms=%s pi=%s', (op, ms, pi) => {
      const d = router.resolve('INVENTORY_CONTROLLED', op, true, true);
      expect(d.ms).toBe(ms);
      expect(d.pi).toBe(pi);
      expect(d.msConditionalOnSync).toBe(false);
    });
  });

  describe('unchanged surfaces', () => {
    it('MANAGED_STOCK + IM on ignores the flag', () => {
      for (const sync of [true, false, undefined]) {
        expect(router.resolve('MANAGED_STOCK', 'reserve', true, sync).ms).toBe('reserve');
        expect(router.resolve('MANAGED_STOCK', 'deduct', true, sync)).toEqual({
          ms: 'deduct',
          pi: 'fulfill',
          msConditionalOnSync: false,
        });
      }
    });

    it('INVENTORY_CONTROLLED + IM off stays SKIP even with sync on', () => {
      expect(router.resolve('INVENTORY_CONTROLLED', 'reserve', false, true)).toEqual({
        ms: 'skip',
        pi: 'skip',
        msConditionalOnSync: false,
      });
    });

    it('ALWAYS_* modes stay SKIP', () => {
      expect(router.resolve('ALWAYS_IN_STOCK', 'reserve', true, true).ms).toBe('skip');
      expect(router.resolve('ALWAYS_OUT_OF_STOCK', 'deduct', true, true).ms).toBe('skip');
    });
  });
});
