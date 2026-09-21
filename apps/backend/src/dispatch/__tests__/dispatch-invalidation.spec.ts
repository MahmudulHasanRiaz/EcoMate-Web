/**
 * P2 freshness tests — dispatch mutations drop cached analytics (§6).
 *
 * updateStatus mutates deliveredAt (the Delivered-date fallback) and syncs
 * the order status; remove drops a fallback source; syncStatusFromCourier
 * stamps event times, advances orders and appends sync timeline entries.
 * Only create() invalidated before — all three now do. Failed-only runs
 * write nothing and invalidate nothing.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from '../dispatch.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStockDeductService } from '../../stock/order-stock-deduct.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { CourierTrackingService } from '../../courier-manager/courier-tracking.service';
import { OrdersService } from '../../orders/orders.service';
import { CacheService } from '../../cache/cache.service';

describe('DispatchService analytics invalidation (P2 §6)', () => {
  let service: DispatchService;
  const mockPrisma: any = {
    $transaction: jest.fn(),
    dispatch: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    order: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    orderStatus: { findUnique: jest.fn() },
    courierDispatchLog: { create: jest.fn() },
  };
  const mockOrders: any = {
    updateStatus: jest.fn().mockResolvedValue({}),
    fireOrderStatusLifecycleEvent: jest.fn().mockResolvedValue(undefined),
  };
  const mockTracking: any = { getDispatchTracking: jest.fn() };
  const mockCache: any = {
    invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOrders.updateStatus.mockResolvedValue({});
    mockOrders.fireOrderStatusLifecycleEvent.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: OrderStockDeductService,
          useValue: { deductForOrder: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CancelReturnStockService,
          useValue: { holdReservationForReturnPending: jest.fn() },
        },
        { provide: CourierTrackingService, useValue: mockTracking },
        { provide: OrdersService, useValue: mockOrders },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get(DispatchService);
    mockPrisma.courierDispatchLog.create.mockResolvedValue({});
    mockPrisma.order.update.mockResolvedValue({});
    mockPrisma.dispatch.update.mockResolvedValue({});
  });

  it('drops analytics:* after a claimed updateStatus (deliveredAt + order sync)', async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValue({
      id: 'd1',
      status: 'ASSIGNED_TO_RIDER',
      orderId: 'o1',
      courier: 'pathao',
      pickedUpAt: new Date('2026-09-10T10:00:00Z'),
      deliveredAt: null,
    });
    const tx: any = {
      dispatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'd1',
          status: 'DELIVERED',
          orderId: 'o1',
          courier: 'pathao',
          consignmentId: 'C-1',
        }),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      trashedAt: null,
      status: { name: 'Shipping' },
      timeline: [],
      items: [],
      customer: null,
    });
    mockPrisma.orderStatus.findUnique.mockResolvedValue({
      id: 's-del',
      name: 'Delivered',
    });

    await service.updateStatus('d1', 'DELIVERED', 'staff-1');

    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });

  it('does not invalidate when updateStatus claims nothing', async () => {
    mockPrisma.dispatch.findUnique.mockResolvedValue({
      id: 'd1',
      status: 'ASSIGNED_TO_RIDER',
      orderId: 'o1',
      courier: 'pathao',
      pickedUpAt: new Date('2026-09-10T10:00:00Z'),
      deliveredAt: null,
    });
    const tx: any = {
      dispatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.updateStatus('d1', 'DELIVERED', 'staff-1');

    expect(mockCache.invalidateByPrefix).not.toHaveBeenCalled();
  });

  it('drops analytics:* after remove', async () => {
    mockPrisma.dispatch.delete.mockResolvedValue({ id: 'd1' });

    await service.remove('d1');

    expect(mockPrisma.dispatch.delete).toHaveBeenCalledWith({
      where: { id: 'd1' },
    });
    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });

  it('drops analytics:* after syncStatusFromCourier writes (unchanged branch still stamps + heals)', async () => {
    mockPrisma.dispatch.findMany.mockResolvedValue([
      {
        id: 'd1',
        courier: 'pathao',
        consignmentId: 'C-1',
        trackingCode: null,
        courierStatus: 'delivered',
        pickedUpAt: new Date('2026-09-10T10:00:00Z'),
        deliveredAt: null,
        orderId: 'o1',
        order: { customer: null, guestPhone: null },
      },
    ]);
    mockTracking.getDispatchTracking.mockResolvedValue({
      currentStatus: 'delivered',
      configured: true,
    });
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      trashedAt: null,
      status: { name: 'Shipping' },
      timeline: [],
      items: [],
      customer: null,
    });
    mockPrisma.orderStatus.findUnique.mockResolvedValue({
      id: 's-del',
      name: 'Delivered',
    });

    const summary = await service.syncStatusFromCourier(['d1'], 'staff-1');

    expect(summary.unchanged).toHaveLength(1);
    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });

  it('does not invalidate when syncStatusFromCourier only fails', async () => {
    mockPrisma.dispatch.findMany.mockResolvedValue([]);

    const summary = await service.syncStatusFromCourier(['ghost'], 'staff-1');

    expect(summary.failed).toHaveLength(1);
    expect(mockCache.invalidateByPrefix).not.toHaveBeenCalled();
  });
});
