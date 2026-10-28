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
  const initialPhysicalStock: any = {
    resolveWarehouse: jest.fn(),
  };
  const ledger: any = { record: jest.fn() };
  const service = new InventoryService(
    prisma,
    stockService,
    stockRouter,
    {} as any,
    ledger,
    { invalidateByPrefix: jest.fn() } as any,
    initialPhysicalStock,
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
    initialPhysicalStock.resolveWarehouse.mockResolvedValue('wh-main');
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

  describe('physical mirror (stock audit #5, owner 2026-10-23)', () => {
    it('mirrors the adjustment to the physical layer when IM is ON', async () => {
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
      prisma.product.findUnique.mockResolvedValue(
        product({ warehouseId: 'wh-1' }),
      );

      await service.adjust('prod-1', 5, 'recount');

      expect(stockService.add).toHaveBeenCalled();
      expect(stockService.operatePhysical).toHaveBeenCalledWith(
        'add',
        expect.objectContaining({
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 5,
          ledgerType: 'ADJUSTMENT',
        }),
      );
      // Field already set → nothing to persist.
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('does NOT touch the physical layer when IM is OFF', async () => {
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(false);
      prisma.product.findUnique.mockResolvedValue(
        product({ warehouseId: 'wh-1' }),
      );

      await service.adjust('prod-1', 5, 'recount');

      expect(stockService.operatePhysical).not.toHaveBeenCalled();
    });

    it('falls back to the warehouse of the product\'s existing physical rows when the product field is unset', async () => {
      // 2026-10-28 staging case: Woo-imported hoodie has physical rows at
      // Dhaka Eco but Product.warehouseId = null — the mirror must use the
      // rows, not fail on the field. The resolved warehouse is persisted
      // onto the product so later adjusts don't re-resolve.
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
      prisma.product.findUnique.mockResolvedValue(
        product({ warehouseId: null }),
      );
      prisma.physicalInventory.findFirst.mockResolvedValue({
        warehouseId: 'wh-phys',
      });

      await service.adjust('prod-1', 5, 'recount');

      expect(stockService.operatePhysical).toHaveBeenCalledWith(
        'add',
        expect.objectContaining({
          productId: 'prod-1',
          warehouseId: 'wh-phys',
          quantity: 5,
          ledgerType: 'ADJUSTMENT',
        }),
      );
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { warehouseId: 'wh-phys' },
      });
    });

    it('falls back to the first active main warehouse when no physical row exists', async () => {
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
      prisma.product.findUnique.mockResolvedValue(
        product({ warehouseId: null }),
      );
      prisma.physicalInventory.findFirst.mockResolvedValue(null);
      initialPhysicalStock.resolveWarehouse.mockResolvedValue('wh-main');

      await service.adjust('prod-1', 5, 'recount');

      expect(initialPhysicalStock.resolveWarehouse).toHaveBeenCalledWith(
        'MANAGED_STOCK',
        5,
      );
      expect(stockService.operatePhysical).toHaveBeenCalledWith(
        'add',
        expect.objectContaining({ warehouseId: 'wh-main' }),
      );
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { warehouseId: 'wh-main' },
      });
    });

    it('throws only when no warehouse exists anywhere (zero-warehouse edge)', async () => {
      // The old "fails loud when IM is ON but the product has no warehouse"
      // test becomes this: the field being null is no longer enough to
      // throw — only a total absence of any warehouse still throws, with
      // the same message staff already know.
      stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
      prisma.product.findUnique.mockResolvedValue(
        product({ warehouseId: null }),
      );
      prisma.physicalInventory.findFirst.mockResolvedValue(null);
      initialPhysicalStock.resolveWarehouse.mockRejectedValue(
        new BadRequestException('no active warehouse'),
      );

      await expect(service.adjust('prod-1', 5, 'recount')).rejects.toThrow(
        /no warehouse set/,
      );
    });

    it('variant path prefers this variant\'s physical row', async () => {
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
      prisma.physicalInventory.findFirst.mockResolvedValue({
        warehouseId: 'wh-var',
      });

      await service.adjust(undefined, 5, 'recount', 'admin@x', 'var-1');

      expect(stockService.add).toHaveBeenCalled();
      expect(stockService.operatePhysical).toHaveBeenCalledWith(
        'add',
        expect.objectContaining({
          variantId: 'var-1',
          warehouseId: 'wh-var',
        }),
      );
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { warehouseId: 'wh-var' },
      });
    });

    it('variant path falls back to any physical row for the product when this variant has none', async () => {
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
      prisma.physicalInventory.findFirst.mockImplementation(
        (args: any) =>
          Promise.resolve(
            args.where.variantId ? null : { warehouseId: 'wh-other' },
          ),
      );

      await service.adjust(undefined, 5, 'recount', 'admin@x', 'var-1');

      expect(stockService.operatePhysical).toHaveBeenCalledWith(
        'add',
        expect.objectContaining({
          variantId: 'var-1',
          warehouseId: 'wh-other',
        }),
      );
    });

    it('variant path resolves the warehouse before writing: missing warehouse → zero writes', async () => {
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
      initialPhysicalStock.resolveWarehouse.mockRejectedValue(
        new BadRequestException('no active warehouse'),
      );

      await expect(
        service.adjust(undefined, 5, 'recount', 'admin@x', 'var-1'),
      ).rejects.toThrow(/no warehouse set/);
      expect(stockService.add).not.toHaveBeenCalled();
      expect(stockService.scrap).not.toHaveBeenCalled();
      expect(stockService.operatePhysical).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('refuses a MANAGED_STOCK product whose manageStock flag is false (the guard gates on the flag, not the mode)', async () => {
      // Regression lock for the 2026-10-27 staging report: a CSV-imported
      // variable product (MANAGED_STOCK mode, manageStock=false) hit exactly
      // this refusal in the "Adjust Managed Stock" dialog. The guard itself
      // is correct — the fix repairs the flag at the write paths and in
      // stored data — but this test pins the refusal to the flag so a
      // future mode-only change cannot silently reopen it.
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
