import { Test, TestingModule } from '@nestjs/testing';
import { CancelReturnStockService } from '../cancel-return-stock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock.service';
import { StockRouterService } from '../stock-router.service';
import { CostingLotService } from '../costing-lot.service';
import { CacheService } from '../../cache/cache.service';

/**
 * The shared cancel-release routine must release BOTH engines exactly once.
 * A retry / double-submit / second cancel caller must be a no-op: the flags
 * and the reservation status are the idempotency gate.
 */
describe('CancelReturnStockService.releaseForCancellation', () => {
  let service: CancelReturnStockService;
  let tx: any;
  let stockService: any;

  // Mutable "database" state — a second call must observe the first call's
  // writes, exactly like the real transaction boundary.
  let cycleActive: boolean;
  let managedReserved: boolean;
  let physicalStatus: 'ACTIVE' | 'RELEASED';

  const product = {
    id: 'prod-1',
    availabilityMode: 'MANAGED_STOCK',
    manageStock: true,
    syncManagedStock: false,
    warehouseId: 'wh-1',
    name: 'Managed Tee',
  };

  beforeEach(async () => {
    cycleActive = true;
    managedReserved = true;
    physicalStatus = 'ACTIVE';

    tx = {
      orderStockCycle: {
        findFirst: jest.fn(async () =>
          cycleActive ? { id: 'cycle-1', status: 'ACTIVE' } : null,
        ),
        update: jest.fn(async () => {
          cycleActive = false;
          return {};
        }),
      },
      order: {
        findUnique: jest.fn(async () => ({
          id: 'order-1',
          items: [
            {
              id: 'item-1',
              orderId: 'order-1',
              productId: 'prod-1',
              variantId: null,
              comboId: null,
              quantity: 2,
              managedStockDeducted: false,
              managedStockReserved: managedReserved,
              product,
            },
          ],
        })),
      },
      orderItem: {
        update: jest.fn(async () => {
          managedReserved = false;
          return {};
        }),
      },
      physicalReservation: {
        findUnique: jest.fn(async () => ({
          id: 'res-1',
          status: physicalStatus,
          productId: 'prod-1',
          variantId: null,
          warehouseId: 'wh-1',
          allocations: [
            { id: 'alloc-1', physicalInventoryId: 'pi-1', quantity: 2 },
          ],
        })),
        update: jest.fn(async () => {
          physicalStatus = 'RELEASED';
          return {};
        }),
      },
      physicalInventory: {
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async () => ({ quantity: 10, reservedQuantity: 2 })),
      },
      orderItemComboComponent: { findMany: jest.fn(), update: jest.fn() },
      comboComponentPhysicalReservation: { findUnique: jest.fn(), update: jest.fn() },
      physicalInventoryLedger: { create: jest.fn() },
      costingLotConsumption: { findFirst: jest.fn() },
      costingLotRestoration: { create: jest.fn() },
      costingLot: { update: jest.fn() },
    };

    stockService = {
      operate: jest.fn().mockResolvedValue(undefined),
      operatePhysical: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancelReturnStockService,
        { provide: PrismaService, useValue: {} },
        { provide: StockService, useValue: stockService },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(true),
            resolve: jest.fn().mockReturnValue({ pi: 'track' }),
          },
        },
        { provide: CostingLotService, useValue: {} },
        {
          provide: CacheService,
          useValue: { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    service = module.get<CancelReturnStockService>(CancelReturnStockService);
  });

  it('releases the managed hold and the physical ACTIVE reservation once, even on double call', async () => {
    await service.releaseForCancellation({
      orderId: 'order-1',
      performedBy: 'staff-1',
      tx,
    });
    await service.releaseForCancellation({
      orderId: 'order-1',
      performedBy: 'staff-1',
      tx,
    });

    // Managed: one guarded release with the cancel reference.
    expect(stockService.operate).toHaveBeenCalledTimes(1);
    expect(stockService.operate).toHaveBeenCalledWith(
      'release',
      expect.objectContaining({
        productId: 'prod-1',
        variantId: undefined,
        quantity: 2,
        reference: 'cancel-order-1',
        performedBy: 'staff-1',
        tx,
        ledgerType: 'CANCEL_RELEASE',
      }),
    );
    expect(tx.orderItem.update).toHaveBeenCalledTimes(1);
    expect(tx.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { managedStockReserved: false } }),
    );

    // Physical: one reservedQuantity decrement, then RELEASED.
    expect(tx.physicalInventory.update).toHaveBeenCalledTimes(1);
    expect(tx.physicalInventory.update).toHaveBeenCalledWith({
      where: { id: 'pi-1' },
      data: { reservedQuantity: { decrement: 2 } },
    });
    expect(tx.physicalReservation.update).toHaveBeenCalledTimes(1);
    expect(tx.physicalReservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'RELEASED' },
    });

    // Cycle terminates once.
    expect(tx.orderStockCycle.update).toHaveBeenCalledTimes(1);
    expect(tx.orderStockCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle-1' },
      data: { status: 'TERMINATED' },
    });
  });
});
