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
 *
 * 2026-11-24 (Issue 2) additions, same file:
 *   - switching INTO INVENTORY_CONTROLLED seeds zero-qty
 *     PhysicalInventory rows (simple: one row, variantId NULL;
 *     variable: one per variant; combo: none), in the product's own
 *     warehouse when set, else the first active warehouse — zero
 *     active warehouses fails loud, never silently picks one.
 *   - cleanup + seeding run inside ONE $transaction, and a re-save
 *     that restates INVENTORY_CONTROLLED repairs a switch whose
 *     side effects never landed (stranded qty / missing rows).
 *   - updateDraft() defers seeding to publish: a fail-loud seeding
 *     error must not break draft autosave.
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
      // Physical-row seeding (2026-11-24, Issue 2): a switch into
      // INVENTORY_CONTROLLED seeds zero-qty PhysicalInventory rows.
      // Defaults are "no rows anywhere, one active warehouse", so the
      // switch seeds exactly the slots the product owns.
      physicalInventory: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      warehouse: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'w1', isActive: true }),
      },
    };
    // The mode-switch side effects run inside ONE $transaction; the
    // mock runs the callback against the same mock client, so every
    // write the transaction makes is visible on `prisma` above.
    (prisma as any).$transaction = jest.fn(
      async (fn: any) => fn(prisma),
    );
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

  const seededRows = (prisma: any) =>
    (prisma.physicalInventory.create as jest.Mock).mock.calls.map(
      (c: any[]) => c[0].data,
    );

  // An already-INVENTORY_CONTROLLED product, as left by a switch whose
  // side effects never landed (old non-transactional switch failed
  // after the mode flip): stranded managed qty + no physical rows.
  const storedIc = (type: string, qty: number, status = 'active') => ({
    ...storedFor(type, qty, status),
    availabilityMode: 'INVENTORY_CONTROLLED',
    manageStock: false,
  });

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

  describe('physical-row seeding on switch into INVENTORY_CONTROLLED (2026-11-24, Issue 2)', () => {
    it('update(): simple MS→IC seeds one zero-qty row, variantId NULL, in the first active warehouse', async () => {
      const stored = storedFor('simple', 7, 'active');
      const { service, prisma } = makeService(stored);

      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );

      const rows = seededRows(prisma);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productId: 'p1',
        variantId: null,
        warehouseId: 'w1',
        quantity: 0,
        reservedQuantity: 0,
      });
      // Zeroing-with-ledger is untouched by the seeding.
      expectCleared(prisma, 'simple', 7);
    });

    it('update(): variable MS→IC seeds one zero-qty row per variant', async () => {
      const stored = storedFor('variable', 0, 'active');
      const variants = [
        { id: 'v1', productId: 'p1', sku: 'V1', managedStockQuantity: 5 },
        { id: 'v2', productId: 'p1', sku: 'V2', managedStockQuantity: -2 },
      ];
      const { service, prisma } = makeService(stored, variants);

      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );

      const rows = seededRows(prisma);
      expect(rows).toHaveLength(2);
      expect(rows.map((r: any) => r.variantId).sort()).toEqual(['v1', 'v2']);
      for (const r of rows) {
        expect(r).toMatchObject({
          productId: 'p1',
          warehouseId: 'w1',
          quantity: 0,
          reservedQuantity: 0,
        });
      }
    });

    it('update(): combo MS→IC seeds nothing (a combo reads its components’ physical stock)', async () => {
      const stored = storedFor('combo', 3, 'active');
      const { service, prisma } = makeService(stored);
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expectCleared(prisma, 'combo', 3);
    });

    it('update(): MS→ALWAYS_IN_STOCK clears but seeds nothing', async () => {
      const stored = storedFor('simple', 9, 'active');
      const { service, prisma } = makeService(stored);
      await service.update(
        'p1',
        { availabilityMode: 'ALWAYS_IN_STOCK' } as any,
        STAFF,
      );
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expect(ledgerRows(prisma)).toHaveLength(1);
    });

    it('update(): reverse switch IC→MS seeds nothing', async () => {
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
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('update(): a row that already exists is not duplicated', async () => {
      const stored = storedFor('simple', 7, 'active');
      const { service, prisma } = makeService(stored);
      (prisma.physicalInventory.findFirst as jest.Mock).mockResolvedValue({
        id: 'pi1',
      });
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      // No missing slot ⇒ warehouse resolution never runs, so an
      // already-covered product never fails for want of a warehouse.
      expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
      expectCleared(prisma, 'simple', 7);
    });

    it('update(): variable with a row for v1 only seeds exactly v2', async () => {
      const stored = storedFor('variable', 0, 'active');
      const variants = [
        { id: 'v1', productId: 'p1', sku: 'V1', managedStockQuantity: 0 },
        { id: 'v2', productId: 'p1', sku: 'V2', managedStockQuantity: 0 },
      ];
      const { service, prisma } = makeService(stored, variants);
      (prisma.physicalInventory.findFirst as jest.Mock).mockImplementation(
        (args: any) =>
          args.where.variantId === 'v1' ? { id: 'pi1' } : null,
      );
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      const rows = seededRows(prisma);
      expect(rows).toHaveLength(1);
      expect(rows[0].variantId).toBe('v2');
    });

    it('update(): the product’s own active warehouse wins over the first active warehouse', async () => {
      const stored = {
        ...storedFor('simple', 7, 'active'),
        warehouseId: 'wh-own',
      };
      const { service, prisma } = makeService(stored);
      (prisma.warehouse.findUnique as jest.Mock).mockResolvedValue({
        id: 'wh-own',
        isActive: true,
      });
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(seededRows(prisma)[0].warehouseId).toBe('wh-own');
      expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
    });

    it('update(): a set warehouse that is inactive fails loud — never silently picks another', async () => {
      const stored = {
        ...storedFor('simple', 7, 'active'),
        warehouseId: 'wh-own',
      };
      const { service, prisma } = makeService(stored);
      (prisma.warehouse.findUnique as jest.Mock).mockResolvedValue({
        id: 'wh-own',
        isActive: false,
      });
      await expect(
        service.update(
          'p1',
          { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
          STAFF,
        ),
      ).rejects.toThrow('missing or inactive');
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
    });

    it('update(): zero active warehouses fails loud — never silently picks one', async () => {
      const stored = storedFor('simple', 7, 'active');
      const { service, prisma } = makeService(stored);
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update(
          'p1',
          { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
          STAFF,
        ),
      ).rejects.toThrow('no active warehouse exists');
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
    });

    it('update(): cleanup + seeding share ONE $transaction', async () => {
      const stored = storedFor('simple', 7, 'active');
      const { service, prisma } = makeService(stored);
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Both writes happen inside the transaction callback: the
      // $transaction call starts before either write.
      const txOrder = (prisma.$transaction as jest.Mock).mock
        .invocationCallOrder[0];
      const ledgerOrder = (prisma.managedStockLedger.create as jest.Mock)
        .mock.invocationCallOrder[0];
      const seedOrder = (prisma.physicalInventory.create as jest.Mock).mock
        .invocationCallOrder[0];
      expect(txOrder).toBeLessThan(ledgerOrder);
      expect(txOrder).toBeLessThan(seedOrder);
    });

    it('updateDraft(): MS→IC clears but does NOT seed — seeding is deferred to publish', async () => {
      const stored = storedFor('simple', 7, 'draft');
      const { service, prisma } = makeService(stored);
      await service.updateDraft('p1', {
        availabilityMode: 'INVENTORY_CONTROLLED',
      } as any);
      expectCleared(prisma, 'simple', 7);
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('publishDraft(): MS→IC seeds the zero-qty row', async () => {
      const stored = storedFor('simple', 7, 'draft');
      const { service, prisma } = makeService(stored);
      await service.publishDraft('p1', {
        availabilityMode: 'INVENTORY_CONTROLLED',
      } as any);
      expectCleared(prisma, 'simple', 7);
      const rows = seededRows(prisma);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productId: 'p1',
        variantId: null,
        warehouseId: 'w1',
        quantity: 0,
      });
    });

    it('publishDraft(): an already-IC draft with a missing row is seeded by the repair', async () => {
      const stored = storedIc('simple', 0, 'draft');
      const { service, prisma } = makeService(stored);
      await service.publishDraft('p1', {} as any);
      expect(prisma.managedStockLedger.create).not.toHaveBeenCalled();
      const rows = seededRows(prisma);
      expect(rows).toHaveLength(1);
      expect(rows[0].variantId).toBe(null);
    });

    it('publishDraft(): an already-IC draft that is already clean seeds nothing', async () => {
      const stored = storedIc('simple', 0, 'draft');
      const { service, prisma } = makeService(stored);
      (prisma.physicalInventory.findMany as jest.Mock).mockResolvedValue([
        { variantId: null },
      ]);
      (prisma.physicalInventory.findFirst as jest.Mock).mockResolvedValue({
        id: 'pi1',
      });
      await service.publishDraft('p1', {} as any);
      expect(prisma.managedStockLedger.create).not.toHaveBeenCalled();
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('re-runnable repair: re-saving INVENTORY_CONTROLLED (2026-11-24, Issue 2)', () => {
    it('update(): restating IC on a stranded product clears the qty AND seeds the row', async () => {
      const stored = storedIc('simple', 5);
      const { service, prisma } = makeService(stored);
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      const rows = ledgerRows(prisma);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'ADJUSTMENT',
        stockBefore: 5,
        stockAfter: 0,
      });
      expect(rows[0].note).toContain(
        'Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED',
      );
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { managedStockQuantity: 0 },
      });
      expect(seededRows(prisma)).toHaveLength(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('update(): restating IC on a clean product is a pure no-op', async () => {
      const stored = storedIc('simple', 0);
      const { service, prisma } = makeService(stored);
      (prisma.physicalInventory.findMany as jest.Mock).mockResolvedValue([
        { variantId: null },
      ]);
      (prisma.physicalInventory.findFirst as jest.Mock).mockResolvedValue({
        id: 'pi1',
      });
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(prisma.managedStockLedger.create).not.toHaveBeenCalled();
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('update(): restating IC with qty 0 but a missing row seeds only — no ledger rows', async () => {
      const stored = storedIc('simple', 0);
      const { service, prisma } = makeService(stored);
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(prisma.managedStockLedger.create).not.toHaveBeenCalled();
      expect(seededRows(prisma)).toHaveLength(1);
    });

    it('update(): a bare rename with no mode in the payload does NOT repair', async () => {
      const stored = storedIc('simple', 5);
      const { service, prisma } = makeService(stored);
      await service.update('p1', { name: 'Renamed' } as any, STAFF);
      expect(prisma.managedStockLedger.create).not.toHaveBeenCalled();
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('update(): variable repair clears each stranded variant and seeds only the missing slot', async () => {
      const stored = storedIc('variable', 0);
      const variants = [
        { id: 'v1', productId: 'p1', sku: 'V1', managedStockQuantity: 3 },
        { id: 'v2', productId: 'p1', sku: 'V2', managedStockQuantity: 0 },
      ];
      const { service, prisma } = makeService(stored, variants);
      (prisma.physicalInventory.findMany as jest.Mock).mockResolvedValue([
        { variantId: 'v1' },
      ]);
      (prisma.physicalInventory.findFirst as jest.Mock).mockImplementation(
        (args: any) =>
          args.where.variantId === 'v1' ? { id: 'pi1' } : null,
      );
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      const rows = ledgerRows(prisma);
      expect(rows).toHaveLength(2);
      expect(
        rows.map((r: any) => [r.variantId, r.stockBefore, r.stockAfter]),
      ).toEqual([
        ['v1', 3, 0],
        ['v2', 0, 0],
      ]);
      const seeded = seededRows(prisma);
      expect(seeded).toHaveLength(1);
      expect(seeded[0].variantId).toBe('v2');
    });

    it('update(): stale reservation flags with zero counters still trigger the cleanup', async () => {
      const stored = storedIc('simple', 0);
      const { service, prisma } = makeService(stored);
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'oi1',
          variantId: null,
          quantity: 2,
          managedStockDeducted: false,
          order: { id: 'o1', displayId: 'ORD-1' },
        },
      ]);
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['oi1'] } },
        data: { managedStockReserved: false },
      });
      const rows = ledgerRows(prisma);
      expect(rows.some((r: any) => r.type === 'RELEASE')).toBe(true);
      expect(
        rows.find((r: any) => r.type === 'RELEASE').referenceId,
      ).toBe('o1');
      // The missing physical row is seeded in the same repair.
      expect(seededRows(prisma)).toHaveLength(1);
    });

    it('updateDraft(): restating IC does NOT repair — the repair runs at publish', async () => {
      const stored = storedIc('simple', 5, 'draft');
      const { service, prisma } = makeService(stored);
      await service.updateDraft('p1', {
        availabilityMode: 'INVENTORY_CONTROLLED',
      } as any);
      expect(prisma.managedStockLedger.create).not.toHaveBeenCalled();
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('update(): a switch that fails loud on seeding is repaired by the next re-save', async () => {
      const stored = storedFor('simple', 5, 'active');
      const { service, prisma } = makeService(stored);
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update(
          'p1',
          { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
          STAFF,
        ),
      ).rejects.toThrow('no active warehouse exists');
      expect(prisma.physicalInventory.create).not.toHaveBeenCalled();
      // In production the main update already flipped the mode before
      // the seeding failure; simulate that stored state for the retry.
      stored.availabilityMode = 'INVENTORY_CONTROLLED';
      (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({
        id: 'w1',
        isActive: true,
      });
      await service.update(
        'p1',
        { availabilityMode: 'INVENTORY_CONTROLLED' } as any,
        STAFF,
      );
      expect(seededRows(prisma)).toHaveLength(1);
      expect(
        ledgerRows(prisma).some(
          (r: any) => r.stockBefore === 5 && r.stockAfter === 0,
        ),
      ).toBe(true);
    });
  });
});
