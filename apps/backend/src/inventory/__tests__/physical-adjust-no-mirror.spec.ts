import { Test, TestingModule } from '@nestjs/testing';
import { PhysicalInventoryController } from '../physical-inventory.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { CacheService } from '../../cache/cache.service';
import { StockRouterService } from '../../stock/stock-router.service';

/**
 * Physical adjust — NO managed mirror (owner decision 2026-11-11).
 *
 * Previously, a physical adjustment on a MANAGED_STOCK product with
 * syncManagedStock=ON overwrote managedStockQuantity with the physical
 * total (single + bulk). That cross-layer write is removed entirely:
 * physical adjust writes ONLY physical rows, for every product, whatever
 * the flag says.
 */
describe('PhysicalInventoryController — no syncManagedStock mirror (2026-11-11)', () => {
  let controller: PhysicalInventoryController;
  let prisma: any;
  let stockService: any;

  beforeEach(async () => {
    prisma = {
      product: {
        // Even a MANAGED_STOCK + sync=ON product must not be mirrored.
        findUnique: jest.fn().mockResolvedValue({
          type: 'simple',
          availabilityMode: 'MANAGED_STOCK',
          syncManagedStock: true,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      productVariant: {
        findUnique: jest.fn().mockResolvedValue({ productId: 'p1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      physicalInventory: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 7 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    stockService = {
      addPhysical: jest.fn().mockResolvedValue([]),
      createCostingLotForAdjustment: jest.fn().mockResolvedValue(undefined),
      deductCostingLotsForAdjustment: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhysicalInventoryController],
      providers: [
        { provide: StockService, useValue: stockService },
        { provide: PrismaService, useValue: prisma },
        {
          provide: StockRouterService,
          useValue: { isInventoryManagementEnabled: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: CacheService,
          useValue: { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    controller = module.get<PhysicalInventoryController>(PhysicalInventoryController);
  });

  it('single adjust writes physical only — managedStockQuantity untouched', async () => {
    await controller.adjust(
      {
        productId: 'p1',
        warehouseId: 'w1',
        quantity: 5,
        unitCost: 10,
        reason: 'restock',
      } as any,
      { email: 'admin@test.com' },
    );

    expect(stockService.addPhysical).toHaveBeenCalledTimes(1);
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
    expect(prisma.physicalInventory.aggregate).not.toHaveBeenCalled();
  });

  it('bulk adjust writes physical only — no managed recompute for any item', async () => {
    await controller.bulkAdjust(
      {
        warehouseId: 'w1',
        reason: 'recount',
        items: [
          { productId: 'p1', quantity: 5, unitCost: 10 },
          { productId: 'p1', variantId: 'v1', quantity: 3, unitCost: 10 },
        ],
      } as any,
      { email: 'admin@test.com' },
    );

    expect(stockService.addPhysical).toHaveBeenCalledTimes(2);
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
    expect(prisma.physicalInventory.aggregate).not.toHaveBeenCalled();
  });
});
