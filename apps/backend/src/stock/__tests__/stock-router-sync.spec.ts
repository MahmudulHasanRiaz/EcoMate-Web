import { StockRouterService } from '../stock-router.service';

/**
 * syncManagedStock routing — AFTER the 2026-11-11 mirror removal.
 *
 * The flag is still merchant-settable through the product DTO, but it no
 * longer has ANY effect: for an INVENTORY_CONTROLLED product with IM on,
 * the managed counters NEVER move, flag on or off — physical is the only
 * layer. MANAGED_STOCK routing never changed and ignores the flag too.
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

  describe('INVENTORY_CONTROLLED + IM on, sync ON (flag IGNORED — managed never moves)', () => {
    it.each([
      ['reserve', 'skip', 'allocate'],
      ['release', 'skip', 'release'],
      ['deduct', 'skip', 'fulfill'],
      ['add', 'skip', 'add'],
      ['allocate', 'skip', 'allocate'],
      ['check', 'skip', 'check'],
      ['scrap', 'skip', 'skip'],
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
