import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { OrderStockDeductService } from '../stock/order-stock-deduct.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { CourierTrackingService } from '../courier-manager/courier-tracking.service';
import { OrdersService } from '../orders/orders.service';
import { BadRequestException } from '@nestjs/common';

describe('DispatchService', () => {
  let service: DispatchService;
  let prisma: any;
  let tracking: any;
  let ordersService: any;

  beforeEach(async () => {
    prisma = {
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'd-1',
          courier: 'pathao',
          consignmentId: 'CG-001',
        }),
        update: jest.fn().mockResolvedValue({ id: 'd-1' }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      courierDispatchLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    tracking = {
      getDispatchTracking: jest.fn().mockResolvedValue(null),
    };

    ordersService = {
      updateStatus: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CancelReturnStockService,
          useValue: {
            holdReservationForReturnPending: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockService,
          useValue: {
            operate: jest.fn().mockResolvedValue([]),
            deduct: jest.fn().mockResolvedValue(undefined),
            fulfillPhysicalReservation: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
            resolve: jest.fn().mockReturnValue({ ms: 'skip', pi: 'skip' }),
          },
        },
        {
          provide: OrderStockDeductService,
          useValue: {
            deductForOrder: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CourierTrackingService, useValue: tracking },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();

    service = module.get<DispatchService>(DispatchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return dispatches list', async () => {
    const result = await service.findAll({});
    expect(result).toEqual({ data: [], total: 0 });
    expect(prisma.dispatch.findMany).toHaveBeenCalled();
  });

  it('should throw on not found', async () => {
    await expect(service.findOne('nonexistent')).rejects.toThrow();
  });

  it('mapper sync: list query includes order.courierStatus for the Courier Status column', async () => {
    prisma.dispatch.findMany.mockResolvedValue([]);
    await service.findAll({});
    const call = prisma.dispatch.findMany.mock.calls[0][0];
    expect(call.include.order.select.courierStatus).toBe(true);
  });

  it('maps dispatch RETURNED to order "Return Pending" (never a raw Returned)', async () => {
    // Dispatch claim: currently RETURN_PENDING, claimed to RETURNED.
    prisma.dispatch.findUnique.mockResolvedValueOnce({
      id: 'd-1',
      status: 'RETURN_PENDING',
    });
    prisma.dispatch.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    // findOne result used inside the transaction (claim winner).
    prisma.dispatch.findUnique.mockResolvedValueOnce({
      id: 'd-1',
      orderId: 'order-1',
      status: 'RETURNED',
      courier: 'pathao',
      consignmentId: 'CG-001',
      productMapping: null,
    });
    prisma.order = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { name: 'Delivered' },
        timeline: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.orderStatus = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'status-return-pending',
        name: 'Return Pending',
      }),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    await service.updateStatus('d-1', 'RETURNED', 'staff-123');

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          statusId: 'status-return-pending',
          timeline: expect.arrayContaining([
            expect.objectContaining({ status: 'Return Pending' }),
          ]),
        }),
      }),
    );
  });

  it('never writes a Returned order status via then dispatch sync path', async () => {
    prisma.dispatch.findUnique
      .mockResolvedValueOnce({ id: 'd-1', status: 'RETURN_PENDING' })
      .mockResolvedValueOnce({
        id: 'd-1',
        orderId: 'order-1',
        status: 'RETURNED',
        courier: 'pathao',
        consignmentId: 'CG-001',
        productMapping: null,
      });
    prisma.dispatch.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.order = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { name: 'Return Pending' },
        timeline: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.orderStatus = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'status-returned',
        name: 'Returned',
      }),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    await service.updateStatus('d-1', 'RETURNED', 'staff-123');

    // syncOrderStatus guards: order already Return Pending → idx<target idx →
    // no write at all; and even if it wrote, it must not be Returned.
    const writes = (prisma.order.update as jest.Mock).mock.calls;
    for (const call of writes) {
      expect(call[0].data.statusId).not.toBe('status-returned');
    }
  });

  it('a staff member can manually move a Partial order forward via dispatch status change', async () => {
    prisma.dispatch.findUnique
      .mockResolvedValueOnce({ id: 'd-1', status: 'PARTIAL' })
      .mockResolvedValueOnce({
        id: 'd-1',
        orderId: 'order-1',
        status: 'RETURN_PENDING',
        courier: 'pathao',
        consignmentId: 'CG-001',
        productMapping: null,
      });
    prisma.dispatch.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.order = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { id: 'status-partial', name: 'Partial' },
        timeline: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.orderStatus = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'status-return-pending',
        name: 'Return Pending',
      }),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    await service.updateStatus('d-1', 'RETURN_PENDING', 'staff-123');

    // Manual staff action IS allowed to move the Partial order forward.
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({ statusId: 'status-return-pending' }),
      }),
    );
  });

  describe('syncStatusFromCourier', () => {
    const dispatchRow = {
      id: 'd-1',
      orderId: 'order-1',
      courier: 'steadfast',
      consignmentId: 'CG-001',
      trackingCode: 'TC-1',
      status: 'DISPATCHED',
      courierStatus: null,
      order: {
        id: 'order-1',
        customer: { phone: '01712345678' },
        guestPhone: null,
      },
    };

    const trackingResult = (overrides: any = {}) => ({
      courier: 'steadfast',
      phone: '01712345678',
      consignmentId: 'CG-001',
      trackingCode: 'TC-1',
      configured: true,
      currentStatus: 'delivered',
      currentMessage: 'Delivered',
      events: [
        { status: 'pending', message: 'Order Placed', timestamp: '2026-08-01T10:00:00Z' },
        { status: 'delivered', message: 'Delivered', timestamp: '2026-08-03T12:00:00Z' },
      ],
      fetchedAt: '2026-08-03T12:30:00.000Z',
      ...overrides,
    });

    beforeEach(() => {
      prisma.dispatch.findMany.mockResolvedValue([dispatchRow]);
    });

    it('throws BadRequestException for an empty id list', async () => {
      await expect(service.syncStatusFromCourier([])).rejects.toThrow(BadRequestException);
      await expect(service.syncStatusFromCourier(['', null as any])).rejects.toThrow(BadRequestException);
    });

    it('reconciles: persists raw courier status AND updates dispatch status separately, advances order', async () => {
      tracking.getDispatchTracking.mockResolvedValue(trackingResult());
      prisma.dispatch.findFirst.mockResolvedValue(null); // no progress for cancel resolution
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { name: 'Packed' },
      });
      prisma.orderStatus.findUnique.mockResolvedValue({
        id: 'status-shipping',
        name: 'Shipping',
      });
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        timeline: [],
      });

      const summary = await service.syncStatusFromCourier(['d-1'], 'admin@x.com');

      expect(summary.synced).toHaveLength(1);
      expect(summary.unchanged).toHaveLength(0);
      expect(summary.failed).toHaveLength(0);

      // Dispatch updated with BOTH separate fields — courier status raw,
      // dispatch status as the mapped enum.
      const dispatchUpdate = prisma.dispatch.update.mock.calls[0][0];
      expect(dispatchUpdate.where).toEqual({ id: 'd-1' });
      expect(dispatchUpdate.data.courierStatus).toBe('delivered');
      expect(dispatchUpdate.data.status).toBe('DELIVERED');
      expect(dispatchUpdate.data.lastSyncedAt).toEqual(expect.any(Date));
      expect(dispatchUpdate.data.courierStatusAt).toEqual(new Date('2026-08-03T12:00:00Z'));

      // Order courier status gets the RAW courier status — never DispatchStatus.
      const orderUpdate = prisma.order.update.mock.calls[0][0];
      expect(orderUpdate.where).toEqual({ id: 'order-1' });
      expect(orderUpdate.data.courierStatus).toBe('delivered');
      expect(orderUpdate.data.courierService).toBe('steadfast');

      // Order status advanced via the same machinery webhooks use.
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ statusId: 'status-shipping' }),
        'system',
      );

      // Sync logged.
      const logCall = prisma.courierDispatchLog.create.mock.calls[0][0].data;
      expect(logCall.status).toBe('SYNCED');
      expect(logCall.orderId).toBe('order-1');
      expect(logCall.consignmentId).toBe('CG-001');
    });

    it('does not overwrite anything when already up to date', async () => {
      prisma.dispatch.findMany.mockResolvedValue([
        { ...dispatchRow, courierStatus: 'delivered' },
      ]);
      tracking.getDispatchTracking.mockResolvedValue(trackingResult());

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.unchanged).toHaveLength(1);
      expect(summary.synced).toHaveLength(0);
      const update = prisma.dispatch.update.mock.calls[0][0];
      expect(update.data.status).toBeUndefined();
      expect(update.data.courierStatus).toBeUndefined();
      expect(update.data.lastSyncedAt).toEqual(expect.any(Date));
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
      expect(prisma.courierDispatchLog.create.mock.calls[0][0].data.status).toBe('SYNC_UNCHANGED');
    });

    it('handles courier API failure safely without touching the dispatch', async () => {
      tracking.getDispatchTracking.mockResolvedValue(
        trackingResult({ error: 'HTTP 500 from steadfast API' }),
      );

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0].reason).toContain('HTTP 500');
      expect(prisma.dispatch.update).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.courierDispatchLog.create.mock.calls[0][0].data.status).toBe('SYNC_FAILED');
    });

    it('fails unsupported couriers without calling any API', async () => {
      prisma.dispatch.findMany.mockResolvedValue([
        { ...dispatchRow, courier: 'hoorin' },
      ]);

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0].reason).toContain('Unsupported courier');
      expect(tracking.getDispatchTracking).not.toHaveBeenCalled();
    });

    it('fails dispatches missing a consignment id', async () => {
      prisma.dispatch.findMany.mockResolvedValue([
        { ...dispatchRow, consignmentId: '' },
      ]);

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0].reason).toContain('Missing consignment id');
      expect(tracking.getDispatchTracking).not.toHaveBeenCalled();
    });

    it('fails when the courier returns no current status', async () => {
      tracking.getDispatchTracking.mockResolvedValue(
        trackingResult({ currentStatus: '' }),
      );

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0].reason).toContain('No courier status');
    });

    it('fails when the courier is not configured', async () => {
      tracking.getDispatchTracking.mockResolvedValue(
        trackingResult({ configured: false, currentStatus: 'pending' }),
      );

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0].reason).toContain('not configured');
      expect(prisma.dispatch.update).not.toHaveBeenCalled();
    });

    it('cancelled with prior progress resolves to RETURN_PENDING (webhook rule)', async () => {
      tracking.getDispatchTracking.mockResolvedValue(
        trackingResult({ currentStatus: 'cancelled' }),
      );
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-2', status: 'DELIVERED' });

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.synced).toHaveLength(1);
      const update = prisma.dispatch.update.mock.calls[0][0];
      expect(update.data.status).toBe('RETURN_PENDING');
      // Order status never auto-advanced to Cancelled by a courier sync.
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('mapped status null keeps DispatchStatus untouched but still records courier status', async () => {
      tracking.getDispatchTracking.mockResolvedValue(
        trackingResult({ currentStatus: 'some-custom-state' }),
      );

      const summary = await service.syncStatusFromCourier(['d-1']);

      expect(summary.synced).toHaveLength(1);
      const update = prisma.dispatch.update.mock.calls[0][0];
      expect(update.data.courierStatus).toBe('some-custom-state');
      expect(update.data.status).toBeUndefined();
      expect(prisma.order.update.mock.calls[0][0].data.courierStatus).toBe('some-custom-state');
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('handles multiple couriers in one batch with per-provider behavior', async () => {
      prisma.dispatch.findMany.mockResolvedValue([
        dispatchRow,
        {
          id: 'd-2',
          orderId: 'order-2',
          courier: 'pathao',
          consignmentId: 'CG-002',
          trackingCode: null,
          status: 'DISPATCHED',
          courierStatus: null,
          order: { id: 'order-2', customer: { phone: '01799999999' }, guestPhone: null },
        },
      ]);
      tracking.getDispatchTracking
        .mockResolvedValueOnce(trackingResult()) // steadfast
        .mockResolvedValueOnce(
          trackingResult({
            courier: 'pathao',
            consignmentId: 'CG-002',
            currentStatus: 'order.on-hold',
          }),
        );

      const summary = await service.syncStatusFromCourier(['d-1', 'd-2']);

      expect(tracking.getDispatchTracking).toHaveBeenCalledTimes(2);
      expect(tracking.getDispatchTracking.mock.calls[0][0]).toBe('steadfast');
      expect(tracking.getDispatchTracking.mock.calls[1][0]).toBe('pathao');
      expect(summary.synced).toHaveLength(2);
      // Steadfast → DELIVERED; Pathao event → HOLD
      expect(prisma.dispatch.update.mock.calls[0][0].data.status).toBe('DELIVERED');
      expect(prisma.dispatch.update.mock.calls[1][0].data.status).toBe('HOLD');
    });

    it('fetches a duplicated consignment only once per batch', async () => {
      const second = {
        ...dispatchRow,
        id: 'd-2',
        orderId: 'order-2',
        order: {
          id: 'order-2',
          customer: { phone: '01712345678' },
          guestPhone: null,
        },
      };
      prisma.dispatch.findMany.mockResolvedValue([dispatchRow, second]);
      tracking.getDispatchTracking.mockResolvedValue(trackingResult());

      const summary = await service.syncStatusFromCourier(['d-1', 'd-2']);

      expect(tracking.getDispatchTracking).toHaveBeenCalledTimes(1);
      expect(summary.synced).toHaveLength(2);
    });

    it('marks unknown ids as failed without an API call', async () => {
      prisma.dispatch.findMany.mockResolvedValue([dispatchRow]);
      tracking.getDispatchTracking.mockResolvedValue(trackingResult());

      const summary = await service.syncStatusFromCourier(['d-1', 'missing-id']);

      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0].reason).toContain('Dispatch not found');
      expect(summary.synced).toHaveLength(1);
    });

    it('never transitions an order that is already Partial (automation stop)', async () => {
      // Courier now reports returned; the order is Partial (automation-stopped).
      tracking.getDispatchTracking.mockResolvedValue(
        trackingResult({ currentStatus: 'returned' }),
      );
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { id: 'status-partial', name: 'Partial' },
      });
      prisma.orderStatus.findUnique.mockResolvedValue({
        id: 'status-return-pending',
        name: 'Return Pending',
      });
      ordersService.updateStatus.mockRejectedValue(
        new BadRequestException('lock'),
      );

      const summary = await service.syncStatusFromCourier(['d-1']);

      // Courier status recorded on dispatch + order, mapped dispatch status set…
      expect(summary.synced).toHaveLength(1);
      expect(prisma.dispatch.update.mock.calls[0][0].data.courierStatus).toBe('returned');
      expect(prisma.dispatch.update.mock.calls[0][0].data.status).toBe('RETURNED');
      // …but the automated order advance was attempted and rejected every time
      // (direct attempt + BFS steps all run under the 'system' actor lock).
      expect(ordersService.updateStatus).toHaveBeenCalled();
      for (const call of (ordersService.updateStatus as jest.Mock).mock.calls) {
        expect(call[0]).toBe('order-1');
        expect(call[2]).toBe('system');
      }
      // The order status must never be touched by the sync.
      for (const call of (prisma.order.update as jest.Mock).mock.calls) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });
  });
});