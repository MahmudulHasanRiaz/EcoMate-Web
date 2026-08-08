import { Test } from '@nestjs/testing';
import { StockReconciliationService } from './stock-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStockDeductService } from './order-stock-deduct.service';
import { CancelReturnStockService } from './cancel-return-stock.service';

describe('StockReconciliationService', () => {
  let service: StockReconciliationService;
  let prisma: any;
  let cancelReturnStock: any;
  let orderStockDeduct: any;

  beforeEach(async () => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      orderItemComboComponent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      comboComponentPhysicalReservation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      physicalReservation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      managedStockLedger: { findMany: jest.fn().mockResolvedValue([]) },
      physicalInventoryLedger: { findMany: jest.fn().mockResolvedValue([]) },
      orderStockCycle: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    cancelReturnStock = { restoreForOrder: jest.fn().mockResolvedValue(undefined) };
    orderStockDeduct = { deductForOrder: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        StockReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderStockDeductService, useValue: orderStockDeduct },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
      ],
    }).compile();

    service = module.get(StockReconciliationService);
  });

  it('deducts stock for Delivered orders', async () => {
    const result = await service.healOrder('order-1', 'Delivered');
    expect(result).toBe('deducted');
    expect(orderStockDeduct.deductForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' }),
    );
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
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
});