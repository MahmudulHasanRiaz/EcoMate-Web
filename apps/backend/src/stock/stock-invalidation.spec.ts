import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stock.service';
import { CancelReturnStockService } from './cancel-return-stock.service';
import { InventoryService } from '../inventory/inventory.service';
import { PhysicalInventoryController } from '../inventory/physical-inventory.controller';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CostingLotService } from './costing-lot.service';
import { StockRouterService } from './stock-router.service';
import { InitialPhysicalStockService } from './initial-physical-stock.service';
import { ManagedStockLedgerService } from '../inventory/managed-stock-ledger.service';

/**
 * Storefront stock-freshness guards.
 *
 * The storefront product page renders `availableStock` from the backend
 * `findBySlug` cache (`product:slug:*`). Every stock-mutating path must
 * invalidate that cache, otherwise the storefront serves stale stock until
 * the TTL expires. These tests lock the invalidation in for the paths that
 * write stock WITHOUT going through stockService.operate/operatePhysical
 * (which invalidate internally).
 */
describe('Product cache invalidation on direct stock writes', () => {
  describe('StockService.fulfillPhysicalReservation', () => {
    let service: StockService;
    let cache: CacheService;

    beforeEach(async () => {
      const prismaMock: any = {
        physicalReservation: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'res-1',
            productId: 'p1',
            variantId: null,
            warehouseId: 'w1',
            status: 'ACTIVE',
            allocations: [{ physicalInventoryId: 'pi-1', quantity: 2 }],
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        physicalInventory: {
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue({ quantity: 3, reservedQuantity: 0 }),
        },
        physicalInventoryLedger: {
          create: jest.fn().mockResolvedValue({}),
        },
        costingLotConsumption: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StockService,
          { provide: PrismaService, useValue: prismaMock },
          {
            provide: CacheService,
            useValue: {
              invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: CostingLotService,
            useValue: {
              consumeFIFOAggregated: jest.fn().mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<StockService>(StockService);
      cache = module.get<CacheService>(CacheService);
    });

    it('invalidates the product cache after consuming a physical reservation', async () => {
      await service.fulfillPhysicalReservation({
        orderId: 'o1',
        cycleId: 'c1',
        orderItemId: 'oi1',
        quantity: 2,
        reference: 'dispatch',
      });

      expect(cache.invalidateByPrefix).toHaveBeenCalledWith('product:');
    });
  });

  describe('CancelReturnStockService.restoreForOrder', () => {
    let service: CancelReturnStockService;
    let cache: CacheService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CancelReturnStockService,
          { provide: PrismaService, useValue: {} },
          {
            provide: StockService,
            useValue: { operate: jest.fn().mockResolvedValue([]) },
          },
          {
            provide: StockRouterService,
            useValue: {
              isInventoryManagementEnabled: jest.fn().mockResolvedValue(true),
              resolve: jest.fn().mockReturnValue({ ms: 'skip', pi: 'add', msConditionalOnSync: false }),
            },
          },
          {
            provide: CostingLotService,
            useValue: { restoreForReturn: jest.fn().mockResolvedValue(undefined) },
          },
          {
            provide: CacheService,
            useValue: {
              invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CancelReturnStockService>(CancelReturnStockService);
      cache = module.get<CacheService>(CacheService);
    });

    it('invalidates the product cache after restoring physical stock', async () => {
      const txMock: any = {
        orderStockCycle: {
          findFirst: jest.fn().mockResolvedValue({ id: 'c1' }),
          update: jest.fn().mockResolvedValue({}),
        },
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'o1',
            items: [
              {
                id: 'oi1',
                productId: 'p1',
                quantity: 2,
                product: {
                  availabilityMode: 'INVENTORY_CONTROLLED',
                  syncManagedStock: false,
                },
              },
            ],
          }),
        },
        physicalReservation: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'CONSUMED',
            productId: 'p1',
            variantId: null,
            warehouseId: 'w1',
            allocations: [{ physicalInventoryId: 'pi-1', quantity: 2 }],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        physicalInventory: {
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ quantity: 5, reservedQuantity: 0 }),
        },
        physicalInventoryLedger: {
          create: jest.fn().mockResolvedValue({}),
        },
        orderItem: { update: jest.fn().mockResolvedValue({}) },
        costingLotConsumption: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        costingLotRestoration: { create: jest.fn().mockResolvedValue({}) },
        costingLot: { update: jest.fn().mockResolvedValue({}) },
      };

      // restoreForOrder receives the transaction client from its caller.
      await service.restoreForOrder({
        orderId: 'o1',
        referencePrefix: 'cancel',
        tx: txMock,
      });

      expect(cache.invalidateByPrefix).toHaveBeenCalledWith('product:');
    });
  });

  describe('InventoryService.adjust (combo path)', () => {
    let service: InventoryService;
    let cache: CacheService;

    beforeEach(async () => {
      const prismaMock: any = {
        combo: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'combo-1',
            name: 'Test Combo',
            items: [
              {
                productId: 'p1',
                quantity: 1,
                variantId: 'v1',
                variant: { managedStockQuantity: 5, sku: 'V1' },
                product: { name: 'P1', manageStock: true },
              },
            ],
          }),
        },
        productVariant: { update: jest.fn().mockResolvedValue({}) },
        product: { update: jest.fn().mockResolvedValue({}) },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          InventoryService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: StockService, useValue: {} },
          { provide: StockRouterService, useValue: {} },
          { provide: CostingLotService, useValue: {} },
          {
            provide: ManagedStockLedgerService,
            useValue: { record: jest.fn().mockResolvedValue({}) },
          },
          {
            provide: CacheService,
            useValue: {
              invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: InitialPhysicalStockService,
            useValue: { resolveWarehouse: jest.fn() },
          },
        ],
      }).compile();

      service = module.get<InventoryService>(InventoryService);
      cache = module.get<CacheService>(CacheService);
    });

    it('invalidates the product cache after direct managedStockQuantity writes', async () => {
      await service.adjust(undefined, 5, 'restock', undefined, undefined, 'combo-1');

      expect(cache.invalidateByPrefix).toHaveBeenCalledWith('product:');
    });
  });

  describe('PhysicalInventoryController.syncManagedStock mirror', () => {
    let controller: PhysicalInventoryController;
    let cache: CacheService;

    beforeEach(async () => {
      const prismaMock: any = {
        productVariant: {
          findUnique: jest.fn().mockResolvedValue({ productId: 'p1' }),
          update: jest.fn().mockResolvedValue({}),
        },
        product: {
          findUnique: jest.fn().mockResolvedValue({
            availabilityMode: 'MANAGED_STOCK',
            syncManagedStock: true,
          }),
        },
        physicalInventory: {
          aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 7 } }),
        },
        // The guard + write share one transaction and lock the location rows.
        $queryRaw: jest.fn().mockResolvedValue([]),
        $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [PhysicalInventoryController],
        providers: [
          {
            provide: StockService,
            useValue: {
              addPhysical: jest.fn().mockResolvedValue([]),
              createCostingLotForAdjustment: jest.fn().mockResolvedValue(undefined),
              deductCostingLotsForAdjustment: jest.fn().mockResolvedValue(undefined),
            },
          },
          { provide: PrismaService, useValue: prismaMock },
          {
            provide: CacheService,
            useValue: {
              invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: StockRouterService,
            useValue: { isInventoryManagementEnabled: jest.fn().mockResolvedValue(true) },
          },
        ],
      }).compile();

      controller = module.get<PhysicalInventoryController>(PhysicalInventoryController);
      cache = module.get<CacheService>(CacheService);
    });

    it('invalidates the product cache after mirroring physical stock into managedStockQuantity', async () => {
      await controller.adjust(
        {
          productId: 'p1',
          variantId: 'v1',
          warehouseId: 'w1',
          quantity: 5,
          unitCost: 10,
          reason: 'restock',
        } as any,
        { email: 'admin@test.com' },
      );

      expect(cache.invalidateByPrefix).toHaveBeenCalledWith('product:');
    });
  });
});
