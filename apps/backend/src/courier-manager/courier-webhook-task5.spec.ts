import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierManagerService } from './courier-manager.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';

/**
 * Task 5 (owner-locked status mappings):
 *  - Steadfast `exceptional` → keep previous Dispatch status + staff alert
 *    (no EXCEPTION value exists in the DispatchStatus enum — verified in
 *    schema.prisma — so the status is kept, never forced to HOLD/DELIVERED).
 *  - 6 return statuses (sourced ONLY from
 *    GET /status_with_return_status_by_cid) → RETURNED/CANCELLED path or
 *    PARTIAL-kept + return state; *_received reconciles stock, NO COD owed.
 *  - RedX `paid` → DELIVERED + Delivered + invoice (Task 1 owner lock;
 *    paid→money-only WITHDRAWN — paid = DELIVERED + money),
 *  - RedX `pickup-pending` → DISPATCHED (booked awaiting pickup).
 *  - Settle exclusion: exceptional / *_approval_pending never settle —
 *    never a DELIVERED dispatch, never a Delivered order advancement.
 */
describe('CourierWebhookService — Task 5 owner-approved status mappings', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;
  let manager: any;
  let cancelReturnStock: any;

  const order = {
    id: 'order-1',
    status: { id: 'status-shipping', name: 'Shipping' },
    timeline: [],
    courierStatus: 'shipping',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'INV-1',
    courierService: 'steadfast',
  };

  const partialStatus = { id: 'status-partial', name: 'Partial' };
  const returnPendingStatus = { id: 'status-rp', name: 'Return Pending' };
  const deliveredStatus = { id: 'status-delivered', name: 'Delivered' };

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
          if (where?.name === 'Delivered') return Promise.resolve(deliveredStatus);
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
    ordersService = {
      updateStatus: jest.fn().mockResolvedValue({}),
    };
    manager = {
      getSteadfastReturnStatus: jest.fn(),
    };
    cancelReturnStock = {
      restoreForOrder: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: manager },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('Steadfast exceptional → keep status + staff alert', () => {
    it('keeps the previous Dispatch status and never advances the order', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'exceptional',
      });

      expect(result.status).toBe('success');
      // No workflow change: the dispatch workflow status is never rewritten…
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      const dispatchUpdates = prisma.dispatch.update.mock.calls as any[];
      for (const [args] of dispatchUpdates) {
        expect(args?.data).not.toHaveProperty('status');
      }
      // …and the order never advances (never HOLD/DELIVERED/settle).
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('records the raw state + timeline alert so staff can see it', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'exceptional',
      });

      // Raw courier state stays visible (Dispatch list "Courier Status" column).
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ courierStatus: 'exceptional' }),
        }),
      );
      expect(prisma.dispatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ courierStatus: 'exceptional' }) }),
      );
      // Timeline alert: kept status + support pointer.
      const entries = timelineEntries();
      const alert = entries.find((e) => e?.courier === 'steadfast' && e?.status === 'exceptional');
      expect(alert).toBeDefined();
      expect(String(alert?.remarks || '')).toMatch(/IN_TRANSIT/);
      expect(String(alert?.remarks || '').toLowerCase()).toMatch(/support/);
    });
  });

  describe('settle exclusion — approval-pending never settles', () => {
    it.each([
      'delivered_approval_pending',
      'cancelled_approval_pending',
      'unknown_approval_pending',
    ])('Steadfast %s never writes DELIVERED and never advances the order to Delivered', async (status) => {
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status,
      });

      expect(result.status).toBe('success');
      const upserts = prisma.dispatch.upsert.mock.calls as any[];
      for (const [args] of upserts) {
        expect(args?.update?.status).not.toBe('DELIVERED');
        expect(args?.create?.status).not.toBe('DELIVERED');
      }
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('exceptional never settles even when the dispatch had delivery progress', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'ASSIGNED_TO_RIDER' });

      await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'exceptional',
      });

      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('RedX paid → DELIVERED + Delivered + invoice (Task 1 owner lock; money-only WITHDRAWN)', () => {
    const paidBody = {
      tracking_number: 'TN-1',
      invoice_number: 'INV-1',
      status: 'paid',
    };

    it('advances the delivery workflow (dispatch DELIVERED + order Delivered)', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      const result = await service.handleRedx(paidBody);

      expect(result.status).toBe('success');
      // Delivery workflow advances (was: no delivery change — withdrawn).
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-delivered' },
        'system',
      );
    });

    it('keeps the money recording (raw paid state + invoice_id for the settlement feed)', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'IN_TRANSIT' });

      await service.handleRedx(paidBody);

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ courierStatus: 'paid' }),
        }),
      );
      const entries = timelineEntries();
      const paid = entries.find(
        (e) => e?.courier === 'redx' && e?.status === 'DELIVERED',
      );
      expect(paid).toBeDefined();
      // The merchant invoice id rides the timeline entry (no new tables).
      expect(paid?.invoiceNumber).toBe('INV-1');
    });
  });

  describe('RedX pickup-pending → DISPATCHED, order untouched', () => {
    it('marks the dispatch DISPATCHED with no order advancement', async () => {
      const result = await service.handleRedx({
        tracking_number: 'TN-1',
        invoice_number: 'INV-1',
        status: 'pickup-pending',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DISPATCHED' }),
        }),
      );
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('reconcileSteadfastReturn (return endpoint vocabulary only)', () => {
    // Task 6 (Fix 13, row 44 owner-locked): the parcel is back — dispatch
    // RETURNED AND the order surfaces as 'Return Pending' for staff
    // confirmation (was advanceOrder null — the order never surfaced).
    it('cancelled_return_received → RETURNED + stock reconcile, no COD, order to Return Pending', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'cancelled_return_received',
      });
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'RETURN_PENDING' });

      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(manager.getSteadfastReturnStatus).toHaveBeenCalledWith('CG-1');
      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          deliveryStatus: 'cancelled_return_received',
          dispatchStatus: 'RETURNED',
          stockReconciled: true,
          codOwed: false,
        }),
      );
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'RETURNED' }),
        }),
      );
      // Stock reconcile hook reused (existing return-stock path, return prefix).
      expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', referencePrefix: 'return' }),
      );
      // NO COD owed: never DELIVERED, never a Delivered advancement.
      const upserts = prisma.dispatch.upsert.mock.calls as any[];
      for (const [args] of upserts) {
        expect(args?.update?.status).not.toBe('DELIVERED');
      }
      // Row 44 fix: the order surfaces as Return Pending for staff
      // confirmation (never Delivered, never Returned directly).
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-rp' },
        'system',
      );
    });

    it('partial_delivered_return_received → PARTIAL kept + return state + stock reconcile', async () => {
      // NOTE (Task 6): this legacy-path assertion holds only when
      // ReturnsService is NOT wired (this spec provides no ReturnsService, so
      // reconcile falls back to the blanket restoreForOrder). Production +
      // Task 6 spec wire ReturnsService: partial received → RECEIVED with NO
      // auto-restore (courier never reports the split). See
      // courier-webhook-task6.spec.ts.
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'partial_delivered_return_received',
      });
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-1', status: 'PARTIAL' });

      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'PARTIAL',
          stockReconciled: true,
          codOwed: false,
        }),
      );
      expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', referencePrefix: 'return' }),
      );
      // Return state rides the timeline (raw return status preserved).
      const entries = timelineEntries();
      const ret = entries.find((e) => e?.returnType === 'partial_delivered_return_received');
      expect(ret).toBeDefined();
      // PARTIAL keeps the authoritative Partial advancement path.
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });

    it('in-flight returns (processing / rider_assigned) never touch stock', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'cancelled_return_rider_assigned',
      });

      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'RETURN_PENDING',
          stockReconciled: false,
          codOwed: false,
        }),
      );
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });

    it('non-return statuses are refused (normal sync owns those)', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({ deliveryStatus: 'delivered' });

      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(expect.objectContaining({ reconciled: false }));
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });

    it('unknown consignments stay 404-loud', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'cancelled_return_received',
      });
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.dispatch.findFirst.mockResolvedValue(null);

      await expect(
        service.reconcileSteadfastReturn({ consignmentId: 'GHOST-1' }),
      ).rejects.toMatchObject({ status: 404 });
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });
  });
});
