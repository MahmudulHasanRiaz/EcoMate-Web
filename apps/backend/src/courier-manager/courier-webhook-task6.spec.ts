import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierManagerService } from './courier-manager.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { ReturnsService } from '../returns/returns.service';

/**
 * Task 6 (Fix 13 §§17.1–17.3): Return records from courier signals.
 *
 * - Pathao `order.return-id-created` keeps its RETURN_PENDING flow AND creates
 *   / links a COURIER Return (courierReturnId = return_consignment_id, type
 *   from return_type, reason stored).
 * - Steadfast `return_request` / `return_list_accepted` keep their record-only
 *   discipline (no dispatch write) AND create / link COURIER Returns storing
 *   the courier ids (return_request_id / return_list_id, per consignment).
 * - reconcileSteadfastReturn creates/updates the Return: in-progress →
 *   IN_TRANSIT (no stock); cancelled received → RECEIVED → RESTOCKED with an
 *   item-level restore of the full order snapshot; partial received →
 *   RECEIVED with NO auto-restore (courier never reports the split — the kept
 *   part must NOT restock; staff confirm quantities at mark-received).
 * - Steadfast webhooks NEVER carry return labels (doc delivery_status
 *   vocabulary is pending/delivered/partial_delivered/cancelled/unknown) —
 *   a return label arriving via webhook is skipped, never a workflow change.
 * - No courier path ever creates an Order row (no phantom Orders).
 */
describe('CourierWebhookService — Return records (Task 6)', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;
  let manager: any;
  let cancelReturnStock: any;
  let returns: any;

  const order = {
    id: 'order-1',
    status: { id: 'status-shipping', name: 'Shipping' },
    timeline: [],
    courierStatus: 'shipping',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'ORD-1',
    courierService: 'steadfast',
  };

  const partialStatus = { id: 'status-partial', name: 'Partial' };
  const returnPendingStatus = { id: 'status-rp', name: 'Return Pending' };

  function timelineEntries(): any[] {
    const calls = prisma.order.update.mock.calls as any[];
    const withTimeline = calls.filter((c) => Array.isArray(c[0]?.data?.timeline));
    return withTimeline.flatMap((c) => c[0].data.timeline);
  }

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(order),
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.name === 'Partial') return Promise.resolve(partialStatus);
          if (where?.name === 'Return Pending') return Promise.resolve(returnPendingStatus);
          return Promise.resolve(null);
        }),
      },
      dispatch: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((cb: any) => cb({})),
    };
    ordersService = { updateStatus: jest.fn().mockResolvedValue({}) };
    manager = { getSteadfastReturnStatus: jest.fn() };
    cancelReturnStock = {
      restoreForOrder: jest.fn().mockResolvedValue(undefined),
      restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
    };
    returns = {
      upsertCourierReturn: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'REQUESTED' }),
      setReturnTransit: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'IN_TRANSIT' }),
      setReturnReceived: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'RECEIVED' }),
      restockReturn: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'RESTOCKED' }),
      orderItemsSnapshot: jest
        .fn()
        .mockResolvedValue([{ productId: 'p-1', quantity: 2 }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: manager },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
        { provide: ReturnsService, useValue: returns },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('Pathao order.return-id-created → Return + RETURN_PENDING flow kept', () => {
    it('creates/links a COURIER Return storing the courier return id + type + reason', async () => {
      const result = await service.handlePathao({
        event: 'order.return-id-created',
        consignment_id: 'CG-1',
        return_consignment_id: 'RL-1',
        merchant_order_id: 'ORD-1',
        return_type: 'partial-delivery',
        reason: 'size issue',
      });

      expect(result.status).toBe('success');
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          courier: 'pathao',
          courierReturnId: 'RL-1',
          type: 'PARTIAL',
          reason: 'size issue',
        }),
      );
      // Existing workflow flow kept: dispatch RETURN_PENDING…
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'RETURN_PENDING' }) }),
      );
      // …order advances to Return Pending…
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-rp' },
        'system',
      );
      // …and no Order row is ever created (no phantom Orders).
      expect(prisma.order.create).toBeUndefined();
    });

    it('maps exchange return_type → EXCHANGE, default → FULL', async () => {
      await service.handlePathao({
        event: 'order.return-id-created',
        consignment_id: 'CG-1',
        return_consignment_id: 'RL-2',
        return_type: 'exchange',
      });
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'EXCHANGE' }),
      );
      await service.handlePathao({
        event: 'order.return-id-created',
        consignment_id: 'CG-1',
        return_consignment_id: 'RL-3',
      });
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'FULL' }),
      );
    });
  });

  describe('Steadfast return_request / return_list_accepted → Return + record-only kept', () => {
    it('return_request links a Return storing return_request_id, still no dispatch write', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'return_request',
        consignment_id: 'CG-1',
        invoice: 'ORD-1',
        return_request_id: 'RR-10',
        reason: 'customer asked',
        status: 'pending',
      });

      expect(result.status).toBe('success');
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          courier: 'steadfast',
          courierReturnId: 'RR-10',
          courierStatus: 'return_request',
          reason: 'customer asked',
        }),
      );
      // Record-only discipline kept: no dispatch workflow write.
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(prisma.dispatch.update).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
      // Timeline still carries the courier id (existing minimal linking).
      const entries = timelineEntries();
      expect(entries.find((e) => e?.returnRequestId === 'RR-10')).toBeDefined();
    });

    it('return_list_accepted links one Return per consignment in the list', async () => {
      // Route by consignment id (addTimelineEntry also calls findFirst by id,
      // so a Once-chain would be consumed by the timeline lookup).
      prisma.order.findFirst.mockImplementation((args: any) => {
        const cid = args?.where?.courierConsignmentId;
        if (cid === 'CG-2') return Promise.resolve({ ...order, id: 'order-2', courierConsignmentId: 'CG-2' });
        if (cid === 'CG-1') return Promise.resolve({ ...order, courierConsignmentId: 'CG-1' });
        return Promise.resolve(order);
      });
      await service.handleSteadfast({
        notification_type: 'return_list_accepted',
        return_list_id: 'RL-5',
        status: 'accepted',
        consignments: ['CG-1', 'CG-2'],
      });
      expect(returns.upsertCourierReturn).toHaveBeenCalledTimes(2);
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', courierReturnId: 'RL-5' }),
      );
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-2', courierReturnId: 'RL-5' }),
      );
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
    });
  });

  describe('reconcileSteadfastReturn drives the Return lifecycle', () => {
    it('in-progress → Return IN_TRANSIT, stock held', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'cancelled_return_rider_assigned',
      });
      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'RETURN_PENDING',
          returnStatus: 'IN_TRANSIT',
          stockReconciled: false,
          codOwed: false,
        }),
      );
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          courier: 'steadfast',
          courierReturnId: 'CG-1',
        }),
      );
      expect(returns.setReturnTransit).toHaveBeenCalledWith('ret-1', 'cancelled_return_rider_assigned');
      expect(returns.restockReturn).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });

    it('cancelled received → RECEIVED → RESTOCKED with a full-order item snapshot', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'cancelled_return_received',
      });
      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'RETURNED',
          returnStatus: 'RESTOCKED',
          stockReconciled: true,
          codOwed: false,
        }),
      );
      expect(returns.setReturnReceived).toHaveBeenCalledWith('ret-1', 'cancelled_return_received');
      // Item-level restore of EXACTLY the order snapshot — never the blanket
      // full-order restore (same quantities here, item-scoped semantics).
      expect(returns.restockReturn).toHaveBeenCalledWith(
        'ret-1',
        expect.objectContaining({ items: [{ productId: 'p-1', quantity: 2 }] }),
      );
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
      // Order advances to Return Pending (row 44 fix), never Delivered.
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-rp' },
        'system',
      );
    });

    it('partial received → Return RECEIVED with NO auto-restore (split unknown)', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'partial_delivered_return_received',
      });
      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'PARTIAL',
          returnStatus: 'RECEIVED',
          stockReconciled: false,
          codOwed: false,
        }),
      );
      expect(returns.setReturnReceived).toHaveBeenCalled();
      // The kept part must NOT restock: no restore of any kind.
      expect(returns.restockReturn).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
    });
  });

  describe('webhooks never carry return labels', () => {
    it.each([
      'cancelled_return_received',
      'cancelled_return_rider_assigned',
      'partial_delivered_return_received',
      'partial_delivered_return_rider_assigned',
    ])('steadfast delivery_status %s → skipped, workflow kept', async (label) => {
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: label,
      });
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
      expect(returns.upsertCourierReturn).not.toHaveBeenCalled();
    });
  });
});
