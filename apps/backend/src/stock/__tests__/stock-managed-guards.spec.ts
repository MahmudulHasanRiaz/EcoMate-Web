import { BadRequestException } from '@nestjs/common';
import { StockService } from '../stock.service';

/**
 * Managed-engine guards (inventory audit fix round, WS1 items 1, 3, 5, 6, 7):
 *  · reserve can never hold more than unreserved on-hand (product + variant);
 *  · INVENTORY_CONTROLLED products' managed legs are a complete no-op —
 *    even with syncManagedStock=true (2026-11-11 mirror removal);
 *  · duplicate targets are aggregated before availability checks;
 *  · negative quantities normalize like the physical path;
 *  · scrap cannot consume reserved units;
 *  · ledger rows are written only for legs that actually moved;
 *  · the legacy costing-lot deduction delegates to the warehouse-scoped FIFO;
 *  · checkPhysicalAvailability requires availableStock > 0.
 */
describe('StockService — managed guards', () => {
  const productRow = (overrides: Record<string, any> = {}) => ({
    id: 'p1',
    type: 'simple',
    manageStock: true,
    availabilityMode: 'MANAGED_STOCK',
    syncManagedStock: false,
    managedStockQuantity: 10,
    reservedStock: 2,
    ...overrides,
  });

  const makeService = () => {
    const tx: any = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      product: {
        findMany: jest.fn().mockResolvedValue([productRow()]),
        findUnique: jest.fn().mockResolvedValue(productRow()),
        update: jest.fn().mockResolvedValue({}),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ productId: 'p1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      combo: { findUnique: jest.fn() },
      inventoryLog: { create: jest.fn().mockResolvedValue({}) },
      managedStockLedger: { create: jest.fn().mockResolvedValue({}) },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      physicalInventory: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const cache = { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) };
    const costingLotService: any = {
      consumeFIFO: jest.fn().mockResolvedValue([]),
      consumeFIFOAggregated: jest.fn().mockResolvedValue([]),
    };
    const service = new StockService(prisma, cache as any, costingLotService);
    return { service, tx, prisma, costingLotService };
  };

  const baseParams = (overrides: Record<string, any> = {}) => ({
    productId: 'p1',
    quantity: 3,
    reference: 'test-ref',
    performedBy: 'staff@x.com',
    ...overrides,
  });

  describe('reserve guard (item 1)', () => {
    it('allows a reserve within unreserved on-hand', async () => {
      const { service, tx } = makeService();
      await service.reserve(baseParams({ quantity: 8, tx }));
      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { reservedStock: { increment: 8 } },
      });
    });

    it('throws when the reserve exceeds unreserved on-hand (10 on hand, 2 held, ask 9)', async () => {
      const { service, tx } = makeService();
      await expect(
        service.reserve(baseParams({ quantity: 9, tx })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('guards the variant branch too', async () => {
      const { service, tx } = makeService();
      tx.product.findMany.mockResolvedValue([productRow({ type: 'variable' })]);
      tx.productVariant.findMany.mockResolvedValue([
        { id: 'v1', productId: 'p1', managedStockQuantity: 4, reservedStock: 1 },
      ]);
      await expect(
        service.reserve(baseParams({ productId: undefined, variantId: 'v1', quantity: 4, tx })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.productVariant.update).not.toHaveBeenCalled();
    });

    it('exempts products that do not track stock (manageStock=false keeps reserving)', async () => {
      const { service, tx } = makeService();
      const row = productRow({ manageStock: false, managedStockQuantity: 0, reservedStock: 0 });
      tx.product.findMany.mockResolvedValue([row]);
      tx.product.findUnique.mockResolvedValue(row);
      await service.reserve(baseParams({ quantity: 5, tx }));
      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { reservedStock: { increment: 5 } },
      });
    });
  });

  describe('mode applicability (items 5c/5d)', () => {
    it('INVENTORY_CONTROLLED without sync: managed reserve is a complete no-op', async () => {
      const { service, tx } = makeService();
      const row = productRow({ availabilityMode: 'INVENTORY_CONTROLLED' });
      tx.product.findMany.mockResolvedValue([row]);
      tx.product.findUnique.mockResolvedValue(row);

      await service.reserve(baseParams({ tx }));

      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.inventoryLog.create).not.toHaveBeenCalled();
      expect(tx.managedStockLedger.create).not.toHaveBeenCalled();
    });

    it('INVENTORY_CONTROLLED with syncManagedStock=true: managed leg STILL a complete no-op (mirror removed 2026-11-11)', async () => {
      const { service, tx } = makeService();
      const row = productRow({
        availabilityMode: 'INVENTORY_CONTROLLED',
        syncManagedStock: true,
      });
      tx.product.findMany.mockResolvedValue([row]);
      tx.product.findUnique.mockResolvedValue(row);

      await service.reserve(baseParams({ tx }));

      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.managedStockLedger.create).not.toHaveBeenCalled();
      expect(tx.inventoryLog.create).not.toHaveBeenCalled();
    });

    it('INVENTORY_CONTROLLED deduct writes no fabricated ledger rows', async () => {
      const { service, tx, costingLotService } = makeService();
      const row = productRow({ availabilityMode: 'INVENTORY_CONTROLLED' });
      tx.product.findMany.mockResolvedValue([row]);
      tx.product.findUnique.mockResolvedValue(row);

      await service.deduct(baseParams({ tx }));

      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.managedStockLedger.create).not.toHaveBeenCalled();
      expect(tx.inventoryLog.create).not.toHaveBeenCalled();
      expect(costingLotService.consumeFIFO).not.toHaveBeenCalled();
    });
  });

  describe('duplicate aggregation (item 5b)', () => {
    it('guards a combo whose components repeat the same product on the SUM', async () => {
      const { service, tx } = makeService();
      tx.combo.findUnique.mockResolvedValue({
        id: 'c1',
        items: [
          { productId: 'p1', variantId: null, quantity: 2 },
          { productId: 'p1', variantId: null, quantity: 3 },
        ],
      });
      // 4 on hand, 0 held: legs of 2 and 3 would each pass alone (the old
      // snapshot bug), the aggregated 5 must not.
      tx.product.findMany.mockResolvedValue([
        productRow({ managedStockQuantity: 4, reservedStock: 0 }),
      ]);

      await expect(
        service.reserve(baseParams({ productId: undefined, comboId: 'c1', quantity: 1, tx })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('writes one aggregated movement when the sum fits', async () => {
      const { service, tx } = makeService();
      tx.combo.findUnique.mockResolvedValue({
        id: 'c1',
        items: [
          { productId: 'p1', variantId: null, quantity: 2 },
          { productId: 'p1', variantId: null, quantity: 3 },
        ],
      });
      tx.product.findMany.mockResolvedValue([
        productRow({ managedStockQuantity: 9, reservedStock: 0 }),
      ]);

      await service.reserve(baseParams({ productId: undefined, comboId: 'c1', quantity: 1, tx }));

      expect(tx.product.update).toHaveBeenCalledTimes(1);
      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { reservedStock: { increment: 5 } },
      });
    });
  });

  describe('negative quantity normalization (item 5a)', () => {
    it("a negative 'add' behaves as a deduct of the magnitude", async () => {
      const { service, tx } = makeService();
      tx.product.findMany.mockResolvedValue([productRow({ reservedStock: 5 })]);

      await service.add(baseParams({ quantity: -3, warehouseId: 'w1', tx }));

      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { managedStockQuantity: { decrement: 3 } },
      });
    });
  });

  describe('scrap guard (item 6)', () => {
    it('cannot scrap units that are reserved for open orders', async () => {
      const { service, tx } = makeService();
      // 10 on hand, 4 reserved → only 6 scrappable.
      tx.product.findMany.mockResolvedValue([productRow({ reservedStock: 4 })]);
      await expect(
        service.scrap(baseParams({ quantity: 7, tx })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('scraps within the unreserved quantity', async () => {
      const { service, tx } = makeService();
      tx.product.findMany.mockResolvedValue([productRow({ reservedStock: 4 })]);
      await service.scrap(baseParams({ quantity: 6, tx }));
      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { managedStockQuantity: { decrement: 6 } },
      });
    });
  });

  describe('legacy costing deduction delegates to the scoped FIFO (item 3)', () => {
    it('consumes via consumeFIFO scoped by product + variant + warehouse, writing consumption rows', async () => {
      const { service, tx, costingLotService } = makeService();
      tx.product.findMany.mockResolvedValue([productRow({ type: 'variable' })]);
      tx.productVariant.findMany.mockResolvedValue([
        { id: 'v1', productId: 'p1', managedStockQuantity: 10, reservedStock: 5 },
      ]);

      await service.deduct(
        baseParams({ productId: undefined, variantId: 'v1', quantity: 3, warehouseId: 'w1', tx }),
      );

      expect(costingLotService.consumeFIFO).toHaveBeenCalledTimes(1);
      expect(costingLotService.consumeFIFO).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'p1',
          variantId: 'v1',
          warehouseId: 'w1',
          quantity: 3,
          type: 'FULFILLMENT',
          referenceType: 'STOCK_DEDUCT',
          allowShortfall: true,
        }),
      );
    });
  });

  describe('checkPhysicalAvailability (item 7)', () => {
    it('reports unavailable when everything on hand is reserved', async () => {
      const { service, prisma } = makeService();
      prisma.physicalInventory.findMany.mockResolvedValue([
        { quantity: 5, reservedQuantity: 5 },
      ]);
      const res = await service.checkPhysicalAvailability('p1', 'w1');
      expect(res.availableStock).toBe(0);
      expect(res.available).toBe(false);
    });

    it('reports available when unreserved stock remains', async () => {
      const { service, prisma } = makeService();
      prisma.physicalInventory.findMany.mockResolvedValue([
        { quantity: 5, reservedQuantity: 3 },
      ]);
      const res = await service.checkPhysicalAvailability('p1', 'w1');
      expect(res.available).toBe(true);
    });
  });
});
