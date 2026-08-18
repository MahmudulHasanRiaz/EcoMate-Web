import { Test } from '@nestjs/testing';
import { StockReconciliationService } from './stock-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStockDeductService } from './order-stock-deduct.service';
import { CancelReturnStockService } from './cancel-return-stock.service';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';

describe('StockReconciliationService', () => {
  let service: StockReconciliationService;
  let prisma: any;
  let cancelReturnStock: any;
  let orderStockDeduct: any;
  let stockService: any;
  let stockRouter: any;

  const manage = (productId: string, variantId: string | null, qty: number) =>
    variantId
      ? {
          id: variantId,
          managedStockQuantity: qty,
          manageStock: true,
          productId,
        }
      : {
          id: productId,
          managedStockQuantity: qty,
          manageStock: true,
        };
  const manageMock = (productId: string, variantId: string | null, qty: number) =>
    () => Promise.resolve(manage(productId, variantId, qty));

  beforeEach(async () => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ status: { name: 'Delivered' } }),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      orderItemComboComponent: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      comboComponentPhysicalReservation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      physicalReservation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      physicalInventory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      managedStockLedger: { findMany: jest.fn().mockResolvedValue([]) },
      physicalInventoryLedger: { findMany: jest.fn().mockResolvedValue([]) },
      orderStockCycle: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ manageStock: true, managedStockQuantity: 0 }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    cancelReturnStock = { restoreForOrder: jest.fn().mockResolvedValue(undefined) };
    orderStockDeduct = { deductForOrder: jest.fn().mockResolvedValue(undefined) };
    stockService = {
      release: jest.fn().mockResolvedValue(undefined),
      deduct: jest.fn().mockResolvedValue(undefined),
    };
    stockRouter = {
      isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
      resolve: jest.fn().mockReturnValue({ ms: 'deduct', pi: 'skip', msConditionalOnSync: false }),
    };

    const module = await Test.createTestingModule({
      providers: [
        StockReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderStockDeductService, useValue: orderStockDeduct },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
        { provide: StockService, useValue: stockService },
        { provide: StockRouterService, useValue: stockRouter },
      ],
    }).compile();

    service = module.get(StockReconciliationService);
  });

  const item = (overrides: Record<string, any> = {}) => ({
    id: 'item-1',
    orderId: 'order-1',
    productId: 'product-1',
    variantId: null,
    comboId: null,
    quantity: 3,
    managedStockReserved: true,
    managedStockDeducted: false,
    product: {
      id: 'product-1',
      type: 'simple',
      manageStock: true,
      availabilityMode: 'MANAGED_STOCK',
      syncManagedStock: null,
    },
    comboComponents: [],
    ...overrides,
  });

  it('deducts stock for Delivered orders when managed on-hand is sufficient', async () => {
    prisma.orderItem.findMany.mockResolvedValue([item()]);
    prisma.product.findUnique.mockImplementation(
      manageMock('product-1', null, 10),
    );

    const result = await service.healOrder('order-1', 'Delivered');

    expect(result).toBe('deducted');
    expect(orderStockDeduct.deductForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' }),
    );
    expect(stockService.release).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('releases orphaned managed reservation when on-hand is insufficient', async () => {
    const it = item();
    prisma.orderItem.findMany.mockResolvedValue([it]);
    prisma.product.findUnique.mockImplementation(manageMock('product-1', null, 1));
    prisma.orderItem.findUnique.mockResolvedValue(it);

    const result = await service.healOrder('order-1', 'Delivered');

    expect(result).toBe('released');
    expect(stockService.release).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'product-1', quantity: 3 }),
    );
    expect(prisma.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-1' }, data: { managedStockReserved: false } }),
    );
    expect(orderStockDeduct.deductForOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        skipManagedUnitIds: new Set(['item-1']),
      }),
    );
  });

  it('does not release when managed on-hand exactly matches quantity', async () => {
    prisma.orderItem.findMany.mockResolvedValue([item()]);
    prisma.product.findUnique.mockImplementation(manageMock('product-1', null, 3));

    const result = await service.healOrder('order-1', 'Delivered');

    expect(result).toBe('deducted');
    expect(stockService.release).not.toHaveBeenCalled();
  });

  it('releases orphaned combo component reservation when component on-hand is insufficient', async () => {
    const comboItem = item({
      id: 'item-combo',
      productId: null,
      comboId: 'combo-1',
      quantity: 1,
      comboComponents: [
        {
          id: 'comp-1',
          orderItemId: 'item-combo',
          productId: 'product-1',
          variantId: null,
          totalQuantity: 3,
          managedStockReserved: true,
          managedStockDeducted: false,
          product: {
            id: 'product-1',
            type: 'simple',
            manageStock: true,
            availabilityMode: 'MANAGED_STOCK',
            syncManagedStock: null,
          },
        },
      ],
    });
    prisma.orderItem.findMany.mockResolvedValue([comboItem]);
    prisma.product.findUnique.mockImplementation(manageMock('product-1', null, 1));
    prisma.orderItemComboComponent.findUnique.mockResolvedValue(comboItem.comboComponents[0]);

    const result = await service.healOrder('order-1', 'Delivered');

    expect(result).toBe('released');
    expect(stockService.release).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'product-1', quantity: 3 }),
    );
    expect(orderStockDeduct.deductForOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        skipManagedUnitIds: new Set(['comp-1']),
      }),
    );
  });

  it('never treats physical-engine (INVENTORY_CONTROLLED) items as orphans', async () => {
    const it = item({
      product: {
        id: 'product-1',
        type: 'simple',
        manageStock: false,
        availabilityMode: 'INVENTORY_CONTROLLED',
        syncManagedStock: null,
      },
    });
    prisma.orderItem.findMany.mockResolvedValue([it]);
    stockRouter.resolve.mockReturnValue({ ms: 'skip', pi: 'fulfill', msConditionalOnSync: false });

    const result = await service.healOrder('order-1', 'Delivered');

    expect(result).toBe('deducted');
    expect(stockService.release).not.toHaveBeenCalled();
    expect(orderStockDeduct.deductForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ skipManagedUnitIds: new Set() }),
    );
  });

  it('releases a held reservation but only for a not-yet-deducted unit', async () => {
    const it = item({ managedStockDeducted: true });
    prisma.orderItem.findMany.mockResolvedValue([it]);
    prisma.product.findUnique.mockImplementation(manageMock('product-1', null, 1));

    const result = await service.healOrder('order-1', 'Delivered');

    expect(result).toBe('deducted');
    expect(stockService.release).not.toHaveBeenCalled();
    expect(orderStockDeduct.deductForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ skipManagedUnitIds: new Set() }),
    );
  });

  it('skips deduction release for units that never held a reservation', async () => {
    const it = item({ managedStockReserved: false });
    prisma.orderItem.findMany.mockResolvedValue([it]);
    prisma.product.findUnique.mockImplementation(manageMock('product-1', null, 0));
    prisma.orderItem.findUnique.mockResolvedValue(it);

    const result = await service.healOrder('order-1', 'Delivered');

    expect(result).toBe('released');
    expect(stockService.release).not.toHaveBeenCalled();
    expect(orderStockDeduct.deductForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ skipManagedUnitIds: new Set(['item-1']) }),
    );
  });

  it('restores stock for Cancelled orders', async () => {
    const result = await service.healOrder('order-1', 'Cancelled');
    expect(result).toBe('restored');
    expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', referencePrefix: 'cancel' }),
    );
  });

  it('restores stock (return prefix) for Returned orders', async () => {
    const result = await service.healOrder('order-1', 'Returned');
    expect(result).toBe('restored');
    expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', referencePrefix: 'return' }),
    );
  });

  it('NEVER touches stock for Return Pending orders', async () => {
    const result = await service.healOrder('order-1', 'Return Pending');
    expect(result).toBe('noop');
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    expect(orderStockDeduct.deductForOrder).not.toHaveBeenCalled();
  });

  it('excludes Return Pending orders from the dirty-stock scan', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        status: { name: 'Return Pending' },
        items: [],
      },
      {
        id: 'order-2',
        status: { name: 'Delivered' },
        items: [{ managedStockReserved: true, managedStockDeducted: false, comboComponents: [] }],
      },
    ]);
    prisma.order.findFirst.mockResolvedValue({
      status: { name: 'Delivered' },
    });
    prisma.orderItem.findMany = jest.fn().mockResolvedValue([]);

    const result = await service.healAll();

    // Return Pending is no longer among scanned statuses.
    const scanWhere = prisma.order.findMany.mock.calls[0][0];
    const scannedNames = scanWhere.where.status.name.in;
    expect(scannedNames).not.toContain('Return Pending');
    // Only the flagged Delivered order survives the dirty-stock filter.
    expect(result.scanned).toBe(1);
  });

  it('reports released orphans in the healAll result', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        status: { name: 'Delivered' },
        items: [{ managedStockReserved: true, managedStockDeducted: false, comboComponents: [] }],
      },
    ]);
    prisma.order.findFirst.mockResolvedValue({ status: { name: 'Delivered' } });
    prisma.orderItem.findMany.mockResolvedValue([item()]);
    prisma.orderItem.findUnique.mockResolvedValue(item());
    prisma.product.findUnique.mockImplementation(manageMock('product-1', null, 0));
    prisma.orderItemComboComponent.findMany.mockResolvedValue([]);

    const result = await service.healAll();

    expect(result.scanned).toBe(1);
    expect(result.releasedOrphaned).toBe(1);
    expect(result.deliveredDeducted).toBe(0);
  });
});
