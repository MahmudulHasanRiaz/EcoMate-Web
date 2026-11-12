import { ProductsService } from '../products.service';

/**
 * Mode-switch cleanup matrix (2026-11-11, directive §2 / audit finding A).
 *
 * Leaving MANAGED_STOCK must zero EVERY managed counter and ledger EVERY
 * clearing — positive, negative AND zero quantities; simple, variable
 * (per-variant) and combo products; on update(), updateDraft() AND
 * publishDraft(). Before this round only qty>0 on update() was cleared:
 * negative quantities survived the switch, combo had no branch at all,
 * and the draft/publish paths never cleaned up.
 *
 * Ledger representation (schema supports it cleanly — quantity is a plain
 * Int, stockBefore/After nullable):
 *   qty > 0 → OUT/ADJUSTMENT, quantity=qty,   stockBefore=qty → 0
 *   qty < 0 → IN/ADJUSTMENT,  quantity=|qty|, stockBefore=qty → 0
 *             (the negative is visibly CLEARED, never sign-flipped)
 *   qty = 0 → quantity-0 ADJUSTMENT note row, 0 → 0 (mode change auditable)
 */
describe('ProductsService — mode-switch managed cleanup (2026-11-11)', () => {
  const STAFF = 'staff@x.com';

  const makeService = (stored: any, variants: any[] = []) => {
    const prisma: any = {
      product: {
        findUnique: jest.fn().mockResolvedValue(stored),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ ...stored, variants: [] }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue(variants),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(variants.length || 1),
      },
      managedStockLedger: { create: jest.fn().mockResolvedValue({}) },
      // Reservation settlement (2026-11-12, Q8 root cause): the mode-switch
      // cleanup now reads flagged OrderItem / OrderItemComboComponent rows
      // via findMany and clears them via updateMany. Defaults are empty
      // lists, so the settlement writes nothing extra and the existing
      // 1-ledger-row assertions below hold.
      orderItem: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orderItemComboComponent: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productTag: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      tag: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new ProductsService(
      prisma,
      { syncEntityImages: jest.fn(async (_t: string, _id: string, imgs: string[]) => imgs), detachAll: jest.fn() } as any,
      { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) } as any,
      { isInventoryManagementEnabled: jest.fn().mockResolvedValue(true) } as any,
      {} as any,
      { operatePhysical: jest.fn().mockResolvedValue(undefined) } as any,
      { parseDefinition: jest.fn(() => []), assertEnabled: jest.fn() } as any,
    );
    return { service, prisma };
  };

  const storedFor = (type: string, qty: number, status: string) => ({
    id: 'p1',
    name: 'Prod',
    slug: 'prod',
    type,
    status,
    availabilityMode: 'MANAGED_STOCK',
    manageStock: true,
    managedStockQuantity: type === 'variable' ? 0 : qty,
    basePrice: 500,
    salePrice: null,
  });

  const variantsFor = (qty: number) => [
    { id: 'v1', productId: 'p1', sku: 'V1', managedStockQuantity: qty },
  ];

  const ledgerRows = (prisma: any) =>
    (prisma.managedStockLedger.create as jest.Mock).mock.calls.map(
      (c: any[]) => c[0].data,
    );

  const expectCleared = (prisma: any, type: string, qty: number) => {
    const rows = ledgerRows(prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: 'p1',
      quantity: Math.abs(qty),
      direction: qty < 0 ? 'IN' : 'OUT',
      type: 'ADJUSTMENT',
      stockBefore: qty,
      stockAfter: 0,
    });
    expect(rows[0].note).toContain(
      `Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED`,
    );
    expect(rows[0].note).toContain(
      type === 'variable'
        ? `variant snapshot: ${qty} units`
        : `snapshot: ${qty} units`,
    );
    if (type === 'variable') {
      expect(rows[0].variantId).toBe('v1');
      if (qty !== 0) {
        expect(prisma.productVariant.update).toHaveBeenCalledWith({
          where: { id: 'v1' },
          data: { managedStockQuantity: 0 },
        });
      } else {
        expect(prisma.productVariant.update).not.toHaveBeenCalled();
      }
    } else if (qty !== 0) {
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { managedStockQuantity: 0 },
      });
    }
  };

  describe.each([
    ['update', 'active'],
    ['updateDraft', 'draft'],
  ] as const)('%s() path', (path, status) => {
    it.each([
      ['simple', 7],
      ['simple', -4],
      ['simple', 0],
      ['variable', 7],
      ['variable', -2],
      ['variable', 0],
      ['combo', 3],
      ['combo', -6],
      ['combo', 0],
    ])('%s with qty %i → cleared + ledgered', async (type, qty) => {
      const stored = storedFor(type, qty, status);
      const variants = type === 'variable' ? variantsFor(qty) : [];
      const { service, prisma } = makeService(stored, variants);

      if (path === 'update') {
        await service.update(
          'p1',
          { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
          STAFF,
        );
        // The acting staff member is stamped on the update() path.
        expect(ledgerRows(prisma)[0].performedById).toBe(STAFF);
      } else {
        await service.updateDraft('p1', {
          availabilityMode: 'INVENTORY_CONTROLLED',
        } as any);
      }

      expectCleared(prisma, type, qty);
    });
  });

  describe('publishDraft() path', () => {
    it.each([
      ['simple', -5],
      ['simple', 0],
      ['variable', -1],
      ['combo', 8],
    ])('%s with qty %i → cleared + ledgered on publish', async (type, qty) => {
      const stored = storedFor(type, qty, 'draft');
      const variants = type === 'variable' ? variantsFor(qty) : [];
      const { service, prisma } = makeService(stored, variants);

      await service.publishDraft('p1', {
        availabilityMode: 'INVENTORY_CONTROLLED',
      } as any);

      expectCleared(prisma, type, qty);
    });

    it('publishing INTO MANAGED_STOCK performs no clearing', async () => {
      const stored = { ...storedFor('simple', 0, 'draft'), availabilityMode: 'INVENTORY_CONTROLLED', manageStock: false };
      const { service, prisma } = makeService(stored);
      await service.publishDraft('p1', {
        availabilityMode: 'MANAGED_STOCK',
      } as any);
      const rows = ledgerRows(prisma);
      expect(rows.every((r: any) => r.type !== 'ADJUSTMENT')).toBe(true);
    });
  });

  describe('variable with mixed-sign variants (the stranded negative-variant case)', () => {
    it('update(): every variant is ledgered — positive, negative and zero alike', async () => {
      const stored = storedFor('variable', 0, 'active');
      const variants = [
        { id: 'v1', productId: 'p1', sku: 'V1', managedStockQuantity: 5 },
        { id: 'v2', productId: 'p1', sku: 'V2', managedStockQuantity: -2 },
        { id: 'v3', productId: 'p1', sku: 'V3', managedStockQuantity: 0 },
      ];
      const { service, prisma } = makeService(stored, variants);

      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );

      const rows = ledgerRows(prisma);
      expect(rows).toHaveLength(3);
      expect(rows.map((r: any) => [r.variantId, r.stockBefore, r.stockAfter])).toEqual([
        ['v1', 5, 0],
        ['v2', -2, 0],
        ['v3', 0, 0],
      ]);
      // Only non-zero variants need a zeroing write; the zero variant's
      // ledger note row is its audit trail.
      expect(prisma.productVariant.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('reverse switch (→ MANAGED_STOCK) is unchanged', () => {
    it('update(): no clearing runs and cleared quantities are NOT resurrected', async () => {
      const stored = {
        ...storedFor('simple', 0, 'active'),
        availabilityMode: 'INVENTORY_CONTROLLED',
        manageStock: false,
      };
      const { service, prisma } = makeService(stored);

      await service.update(
        'p1',
        { availabilityMode: 'MANAGED_STOCK' } as any,
        STAFF,
      );

      const rows = ledgerRows(prisma);
      // Only the pre-existing INITIAL row for entering MANAGED_STOCK.
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('INITIAL');
      expect(prisma.product.update).not.toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { managedStockQuantity: 0 },
      });
      // Nothing writes a positive quantity back onto the product.
      for (const call of (prisma.product.update as jest.Mock).mock.calls) {
        const qty = call[0]?.data?.managedStockQuantity;
        expect(qty === undefined || qty === 0).toBe(true);
      }
    });

    it('no mode change → no ledger rows at all', async () => {
      const stored = storedFor('simple', 9, 'active');
      const { service, prisma } = makeService(stored);
      await service.update('p1', { name: 'Renamed' } as any, STAFF);
      expect(prisma.managedStockLedger.create).not.toHaveBeenCalled();
    });
  });

  describe('other target modes', () => {
    it('updateDraft() to ALWAYS_IN_STOCK also clears (any non-managed target)', async () => {
      const stored = storedFor('simple', 9, 'draft');
      const { service, prisma } = makeService(stored);
      await service.updateDraft('p1', {
        availabilityMode: 'ALWAYS_IN_STOCK',
      } as any);
      const rows = ledgerRows(prisma);
      expect(rows).toHaveLength(1);
      expect(rows[0].note).toContain('to ALWAYS_IN_STOCK');
      expect(rows[0].stockBefore).toBe(9);
    });
  });
});
