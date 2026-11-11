import { BadRequestException } from '@nestjs/common';
import { InventoryService } from '../inventory.service';

/**
 * Managed-stock counterpart of the physical adjustment guard: one mis-keyed
 * entry must not be able to silently zero a managed position.
 */
describe('InventoryService — managed-stock destructive guard', () => {
  const prisma: any = {
    product: { findUnique: jest.fn(), update: jest.fn() },
    productVariant: { findUnique: jest.fn() },
    physicalInventory: { findFirst: jest.fn() },
    combo: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const stockService: any = {
    add: jest.fn(),
    scrap: jest.fn(),
    operatePhysical: jest.fn().mockResolvedValue(undefined),
  };
  const stockRouter: any = {
    isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
  };
  const ledger: any = { record: jest.fn() };
  const service = new InventoryService(
    prisma,
    stockService,
    stockRouter,
    {} as any,
    ledger,
    { invalidateByPrefix: jest.fn() } as any,
  );

  const product = (over: Record<string, any> = {}) => ({
    id: 'prod-1',
    name: 'Test Product',
    sku: 'TP-1',
    type: 'simple',
    manageStock: true,
    availabilityMode: 'MANAGED_STOCK',
    managedStockQuantity: 10,
    reservedStock: 0,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.product.findUnique.mockResolvedValue(product());
    prisma.product.update.mockResolvedValue(product());
    prisma.physicalInventory.findFirst.mockResolvedValue(null);
    stockService.scrap.mockResolvedValue([]);
    stockService.add.mockResolvedValue([]);
  });

  it('blocks a deduction that would remove >=90% of available managed stock', async () => {
    await expect(service.adjust('prod-1', -10, 'recount')).rejects.toThrow(
      BadRequestException,
    );
    expect(stockService.scrap).not.toHaveBeenCalled();
  });

  it('carries a stable DESTRUCTIVE_ADJUSTMENT code with the existing message unchanged', async () => {
    const err = await service
      .adjust('prod-1', -10, 'recount')
      .then(() => null)
      .catch((e: unknown) => e as BadRequestException);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      code: 'DESTRUCTIVE_ADJUSTMENT',
      message:
        'This adjustment would remove 10 of 10 available for "Test Product" (100%). ' +
        'Re-submit with confirmDestructive=true if this is intentional.',
    });
  });

  it('carries the code on the no-available-stock branch too', async () => {
    prisma.product.findUnique.mockResolvedValue(
      product({ managedStockQuantity: 5, reservedStock: 5 }),
    );
    const err = await service
      .adjust('prod-1', -1, 'recount')
      .then(() => null)
      .catch((e: unknown) => e as BadRequestException);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      code: 'DESTRUCTIVE_ADJUSTMENT',
      message:
        'This adjustment would remove 1 from "Test Product", ' +
          'which has no available stock (5 on hand, 5 reserved). ' +
          'Re-submit with confirmDestructive=true if this is intentional.',
    });
  });

  it('allows the same deduction when explicitly confirmed', async () => {
    await expect(
      service.adjust('prod-1', -10, 'write-off', 'admin@x', undefined, undefined, true),
    ).resolves.toBeDefined();
    expect(stockService.scrap).toHaveBeenCalled();
  });

  it('blocks any deduction when reserved >= on hand (nothing available)', async () => {
    prisma.product.findUnique.mockResolvedValue(
      product({ managedStockQuantity: 5, reservedStock: 5 }),
    );
    await expect(service.adjust('prod-1', -1, 'recount')).rejects.toThrow(
      /no available stock/,
    );
    expect(stockService.scrap).not.toHaveBeenCalled();
  });

  it('allows a normal partial deduction untouched', async () => {
    await expect(service.adjust('prod-1', -2, 'damaged')).resolves.toBeDefined();
    expect(stockService.scrap).toHaveBeenCalled();
  });

  it('ignores reserved stock when adding stock (no false positive)', async () => {
    prisma.product.findUnique.mockResolvedValue(
      product({ managedStockQuantity: 0, reservedStock: 0 }),
    );
    await expect(service.adjust('prod-1', 5, 'restock')).resolves.toBeDefined();
    expect(stockService.add).toHaveBeenCalled();
  });

  it('applies the same guard to the variant path', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'var-1',
      sku: 'TP-1-RED',
      managedStockQuantity: 8,
      reservedStock: 0,
      product: {
        id: 'prod-1',
        name: 'Test Product',
        type: 'variable',
        manageStock: true,
        availabilityMode: 'MANAGED_STOCK',
      },
    });

    await expect(service.adjust(undefined, -8, 'recount', 'admin@x', 'var-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(stockService.scrap).not.toHaveBeenCalled();

    await expect(
      service.adjust(undefined, -8, 'write-off', 'admin@x', 'var-1', undefined, true),
    ).resolves.toBeDefined();
    expect(stockService.scrap).toHaveBeenCalled();
  });

  describe('NO physical mirror (owner decision 2026-11-11 — layers independent)', () => {
    it('does NOT touch the physical layer even when IM is ON and a warehouse is set', async () => {
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
      prisma.product.findUnique.mockResolvedValue(
        product({ warehouseId: 'wh-1' }),
      );

      await service.adjust('prod-1', 5, 'recount');

      expect(stockService.add).toHaveBeenCalled();
      expect(stockService.operatePhysical).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('managed adjust SUCCEEDS when no warehouse exists anywhere (zero-warehouse case)', async () => {
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
      prisma.product.findUnique.mockResolvedValue(
        product({ warehouseId: null }),
      );
      prisma.physicalInventory.findFirst.mockResolvedValue(null);

      await expect(service.adjust('prod-1', 5, 'recount')).resolves.toBeDefined();
      expect(stockService.add).toHaveBeenCalled();
      expect(stockService.operatePhysical).not.toHaveBeenCalled();
    });

    it('variant path also succeeds with no warehouse anywhere and writes no physical row', async () => {
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
      prisma.product.findUnique.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'var-1',
        sku: 'TP-1-RED',
        managedStockQuantity: 8,
        reservedStock: 0,
        product: {
          id: 'prod-1',
          name: 'Test Product',
          type: 'variable',
          manageStock: true,
          availabilityMode: 'MANAGED_STOCK',
          warehouseId: null,
        },
      });
      prisma.physicalInventory.findFirst.mockResolvedValue(null);

      await expect(
        service.adjust(undefined, 5, 'recount', 'admin@x', 'var-1'),
      ).resolves.toBeDefined();
      expect(stockService.add).toHaveBeenCalled();
      expect(stockService.operatePhysical).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('combo path writes managed only — no physical row for any component', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      prisma.combo.findUnique.mockResolvedValue({
        id: 'combo-1',
        name: 'Bundle',
        items: [
          {
            productId: 'prod-1',
            variantId: null,
            quantity: 2,
            product: product(),
            variant: null,
          },
        ],
      });
      prisma.product.update.mockResolvedValue(product());

      await service.adjust(undefined, 3, 'recount', 'admin@x', undefined, 'combo-1');

      expect(stockService.operatePhysical).not.toHaveBeenCalled();
      expect(ledger.record).toHaveBeenCalled();
    });

    it('refuses a MANAGED_STOCK product whose manageStock flag is false (the guard gates on the flag, not the mode)', async () => {
      prisma.product.findUnique.mockResolvedValue(
        product({ manageStock: false, availabilityMode: 'MANAGED_STOCK' }),
      );

      await expect(
        service.adjust('prod-1', 5, 'Supplier restock', undefined, 'variant-1'),
      ).rejects.toThrow('Stock tracking is disabled for this product');
      expect(stockService.add).not.toHaveBeenCalled();
      expect(stockService.scrap).not.toHaveBeenCalled();
    });
  });

});
