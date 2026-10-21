import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from '../courier-webhook.service';
import { CourierManagerService } from '../courier-manager.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { CodMismatchService } from '../../cod-mismatch/cod-mismatch.service';
import { ReturnsService } from '../../returns/returns.service';
import {
  mapCourierStatusToDispatchStatus,
  mapSteadfastReturnStatus,
} from '../courier-status-mapper';

/**
 * Task A batch (final follow-up):
 * F2 partial lock · F3 unknown→null+alert · F4 ready→ASSIGNED_TO_RIDER +
 * returned→RETURN_PENDING · F10 RETURNED→Return Pending only ·
 * F11 Shipping→Return Pending direct · sheet extras (a)–(g).
 *
 * RED first: CHANGE items must FAIL before the fix, lock items must PASS.
 */
describe('Courier Task A — mapping corrections batch', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;
  let manager: any;
  let cancelReturnStock: any;
  let codMismatch: any;

  const shippingOrder = {
    id: 'order-1',
    status: { id: 'status-shipping', name: 'Shipping' },
    timeline: [],
    shippingAddress: {},
    courierStatus: 'shipping',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'INV-1',
    courierService: 'steadfast',
  };

  const partialStatus = { id: 'status-partial', name: 'Partial' };
  const returnPendingStatus = { id: 'status-rp', name: 'Return Pending' };
  const deliveredStatus = { id: 'status-delivered', name: 'Delivered' };
  const shippingStatus = { id: 'status-shipping', name: 'Shipping' };

  function timelineEntries(): any[] {
    const calls = (prisma.order.update as jest.Mock).mock.calls as any[];
    const withTimeline = calls.filter((c) => Array.isArray(c[0]?.data?.timeline));
    return withTimeline.flatMap((c) => c[0].data.timeline);
  }

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(shippingOrder),
        findUnique: jest.fn().mockResolvedValue(shippingOrder),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.name === 'Partial') return Promise.resolve(partialStatus);
          if (where?.name === 'Return Pending') return Promise.resolve(returnPendingStatus);
          if (where?.name === 'Delivered') return Promise.resolve(deliveredStatus);
          if (where?.name === 'Shipping') return Promise.resolve(shippingStatus);
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
    cancelReturnStock = { restoreForOrder: jest.fn().mockResolvedValue(undefined) };
    codMismatch = { recompute: jest.fn().mockResolvedValue([]) };
    const returns = {
      upsertCourierReturn: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'REQUESTED' }),
      setReturnTransit: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'IN_TRANSIT' }),
      recordCourierParcelBack: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'REQUESTED' }),
      restockReturn: jest.fn().mockResolvedValue({ id: 'ret-1', status: 'RESTOCKED' }),
      orderItemsSnapshot: jest.fn().mockResolvedValue([{ productId: 'p-1', quantity: 2 }]),
      findOpenStaffReturnWithItems: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: manager },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
        { provide: CodMismatchService, useValue: codMismatch },
        { provide: ReturnsService, useValue: returns },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('F2 — partial uniform (LOCK, no mapping change)', () => {
    it('approval-pending → PARTIAL + never Delivered (steadfast webhook)', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'partial_delivered_approval_pending',
      });
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'PARTIAL' }) }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
      const upserts = (prisma.dispatch.upsert as jest.Mock).mock.calls as any[];
      for (const [args] of upserts) {
        expect(args?.update?.status).not.toBe('DELIVERED');
      }
    });

    it('partial_delivered_return_received → PARTIAL + parcel back recorded (no auto-restore) + COD-not-owed + NEVER Delivered', async () => {
      // Unified path (ReturnsService REQUIRED — HIGH legacy-restore fix) NEVER
      // blanket-restores a partial (that would restock the kept part) — it
      // HOLDs with a LOUD "confirm items to restock" alert. Mapper intent flag
      // stays reconcileStock:true (parcel physically back); the path derives
      // HOLD from the actual outcome via the staff-Return lookup — see
      // courier-webhook-partial-restore.spec.ts.
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'partial_delivered_return_received',
      });
      const mapped = mapSteadfastReturnStatus('partial_delivered_return_received');
      expect(mapped).toEqual(
        expect.objectContaining({
          dispatchStatus: 'PARTIAL',
          reconcileStock: true,
          codOwed: false,
        }),
      );
      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });
      expect(result).toEqual(
        expect.objectContaining({ dispatchStatus: 'PARTIAL', stockReconciled: false, codOwed: false }),
      );
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
      const remarks = timelineEntries()
        .map((e: any) => String(e?.remarks || ''))
        .join('\n');
      expect(remarks).toMatch(/awaiting staff receive/);
      expect(remarks).not.toMatch(/stock reconciled/);
      expect(ordersService.updateStatus).not.toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ statusId: 'status-delivered' }),
        expect.anything(),
      );
    });

    it('sync mapper: approval-pending → PARTIAL (never null/DELIVERED)', () => {
      expect(mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_approval_pending')).toBe(
        'PARTIAL',
      );
    });
  });

  describe('F3 — unknown → null + alert (BOTH maps)', () => {
    it('sync mapper: steadfast unknown → null', () => {
      expect(mapCourierStatusToDispatchStatus('steadfast', 'unknown')).toBeNull();
    });

    it('webhook: unknown records raw + timeline + loud log + alert, no state change', async () => {
      const errSpy = jest.spyOn((service as any).logger, 'error');
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'unknown',
      });
      expect(result.status).toBe('success');
      // Raw courier state persisted on the order…
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ courierStatus: 'unknown' }),
        }),
      );
      // …timeline alert so staff can see it…
      const entries = timelineEntries();
      const alert = entries.find(
        (e) => e?.courier === 'steadfast' && String(e?.status || '').includes('unknown'),
      );
      expect(alert).toBeDefined();
      // …loud log…
      expect(errSpy.mock.calls.length + warnSpy.mock.calls.length).toBeGreaterThan(0);
      // …no workflow change: never CANCELLED, never an order advance.
      const upserts = (prisma.dispatch.upsert as jest.Mock).mock.calls as any[];
      for (const [args] of upserts) {
        expect(args?.update?.status).not.toBe('CANCELLED');
        expect(args?.create?.status).not.toBe('CANCELLED');
      }
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
      errSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('F4 — redx ready-for-delivery + returned', () => {
    it('sync mapper: ready-for-delivery → ASSIGNED_TO_RIDER', () => {
      expect(mapCourierStatusToDispatchStatus('redx', 'ready-for-delivery')).toBe(
        'ASSIGNED_TO_RIDER',
      );
    });

    it('webhook: ready-for-delivery → ASSIGNED_TO_RIDER + order Shipping', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...shippingOrder,
        status: { id: 'status-packed', name: 'Packed' },
      });
      prisma.order.findUnique.mockResolvedValue({
        ...shippingOrder,
        status: { id: 'status-packed', name: 'Packed' },
      });
      const result = await service.handleRedx({
        tracking_number: 'TN-1',
        invoice_number: 'INV-1',
        status: 'ready-for-delivery',
      });
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'ASSIGNED_TO_RIDER' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ statusId: 'status-shipping' }),
        'system',
      );
    });

    it('webhook: returned → RETURN_PENDING + order Return Pending + NO stock + NOT Returned', async () => {
      const result = await service.handleRedx({
        tracking_number: 'TN-1',
        invoice_number: 'INV-1',
        status: 'returned',
      });
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'RETURN_PENDING' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-rp' },
        'system',
      );
      const upserts = (prisma.dispatch.upsert as jest.Mock).mock.calls as any[];
      for (const [args] of upserts) {
        expect(args?.update?.status).not.toBe('RETURNED');
      }
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });
  });

  describe('F10 — RETURNED dispatch → Return Pending ONLY (all couriers)', () => {
    it('pathao returned-to-merchant → RETURNED dispatch → Return Pending order, never Returned', async () => {
      await service.handlePathao({
        event: 'order.returned-to-merchant',
        consignment_id: 'CG-1',
      });
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'RETURNED' }) }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ statusId: 'status-rp' }),
        'system',
      );
      const statusIds = (ordersService.updateStatus as jest.Mock).mock.calls.map(
        (c: any[]) => (c[1] as any)?.statusId,
      );
      expect(statusIds).not.toContain('status-returned');
    });

    it('carrybee returned-to-merchant → RETURNED dispatch → Return Pending order, never Returned', async () => {
      await service.handleCarrybee({
        event: 'order.returned-to-merchant',
        consignment_id: 'CG-1',
      });
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'RETURNED' }) }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ statusId: 'status-rp' }),
        'system',
      );
    });
  });

  describe('F11 — Shipping → Return Pending DIRECT (never via Delivered)', () => {
    it('direct success: single Return Pending advance, no Delivered step', async () => {
      await service.handlePathao({
        event: 'order.returned',
        consignment_id: 'CG-1',
      });
      const calls = (ordersService.updateStatus as jest.Mock).mock.calls as any[][];
      const statusIds = calls.map((c) => (c[1] as any)?.statusId);
      expect(statusIds).toContain('status-rp');
      expect(statusIds).not.toContain('status-delivered');
    });

    it('direct failure: never steps via Delivered + staff-visible log', async () => {
      ordersService.updateStatus.mockRejectedValueOnce(new Error('direct blocked'));
      ordersService.updateStatus.mockResolvedValue({});
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      await service.handlePathao({
        event: 'order.returned',
        consignment_id: 'CG-1',
      });
      const calls = (ordersService.updateStatus as jest.Mock).mock.calls as any[][];
      const statusIds = calls.map((c) => (c[1] as any)?.statusId);
      // Direct attempted…
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // …but Delivered is never used as a stepping stone.
      expect(statusIds).not.toContain('status-delivered');
      // Staff-visible: warn log and/or timeline note.
      const entries = timelineEntries();
      const sawWarn = warnSpy.mock.calls.length > 0;
      const sawTimeline = entries.some((e) => /Return Pending/i.test(String(e?.status || e?.note || '')));
      expect(sawWarn || sawTimeline).toBe(true);
      warnSpy.mockRestore();
    });
  });

  describe('extras (a) — PICKED_UP marks HANDOVER stage complete in timeline', () => {
    it('pathao picked timeline carries the HANDOVER marker', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...shippingOrder,
        status: { id: 'status-packed', name: 'Packed' },
      });
      prisma.order.findFirst.mockResolvedValue({
        ...shippingOrder,
        status: { id: 'status-packed', name: 'Packed' },
        timeline: [],
      });
      await service.handlePathao({ event: 'order.picked', consignment_id: 'CG-1' });
      const entries = timelineEntries();
      const picked = entries.find((e) => e?.status === 'PICKED_UP');
      expect(picked).toBeDefined();
      expect(String(picked?.remarks || picked?.note || '')).toMatch(/HANDOVER/i);
    });
  });

  describe('extras (b) — consignment_update applies fields, no status change', () => {
    it('address change updates the order, never the workflow', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'consignment_update',
        consignment_id: 'CG-1',
        invoice: 'INV-1',
        changed: ['cus_address'],
        values: { cus_address: 'House 12, Road 5, Mirpur' },
      });
      expect(result.status).toBe('success');
      const orderUpdates = (prisma.order.update as jest.Mock).mock.calls as any[][];
      const addrWrite = orderUpdates.find((c) =>
        JSON.stringify(c[0]?.data || '').includes('House 12, Road 5, Mirpur'),
      );
      expect(addrWrite).toBeDefined();
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('COD change triggers the codMismatch recompute, no status change', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'consignment_update',
        consignment_id: 'CG-1',
        invoice: 'INV-1',
        changed: ['cod_amount'],
        values: { cod_amount: 1500 },
      });
      expect(result.status).toBe('success');
      expect(codMismatch.recompute).toHaveBeenCalledWith('order-1');
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('extras (c) — informational notification types are recorded, never moved', () => {
    it.each([
      'return_list_accepted',
      'payment_request',
      'cancel_request',
      'return_request',
      'pickup_request',
      'user_update',
    ])('%s is recorded with no workflow change', async (notificationType) => {
      const result = await service.handleSteadfast({
        notification_type: notificationType,
        consignment_id: 'CG-1',
        invoice: 'INV-1',
        return_list_id: 'RL-1',
        return_request_id: 'RR-1',
        payment_request_id: 'PR-1',
        cancel_request_id: 'CR-1',
        pickup_request_id: 'PK-1',
      });
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
      const entries = timelineEntries();
      // user_update is account-level (no parcel link required); the rest link.
      if (notificationType !== 'user_update') {
        expect(entries.length).toBeGreaterThan(0);
      }
    });

    it('return_request stores the return id on the timeline (minimal T6 link)', async () => {
      await service.handleSteadfast({
        notification_type: 'return_request',
        consignment_id: 'CG-1',
        invoice: 'INV-1',
        return_request_id: 'RR-42',
      });
      const blob = JSON.stringify(timelineEntries());
      expect(blob).toContain('RR-42');
    });
  });

  describe('extras (d) — pathao order.updated records the delivery_fee change', () => {
    it('delivery_fee rides the timeline, workflow unchanged', async () => {
      const result = await service.handlePathao({
        event: 'order.updated',
        consignment_id: 'CG-1',
        delivery_fee: 83.46,
      });
      expect(result.status).toBe('success');
      const entries = timelineEntries();
      const upd = entries.find((e) => e?.status === 'order.updated');
      expect(upd).toBeDefined();
      expect(JSON.stringify(upd)).toContain('83.46');
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('extras (e) — paid-return collected definite-only (LOCK)', () => {
    it('definite collected_amount is recorded; absent stays absent', async () => {
      await service.handlePathao({
        event: 'order.paid-return',
        consignment_id: 'CG-1',
        collected_amount: 60,
      });
      let entries = timelineEntries();
      expect(JSON.stringify(entries)).toContain('60');

      (prisma.order.update as jest.Mock).mockClear();
      await service.handlePathao({
        event: 'order.paid-return',
        consignment_id: 'CG-1',
      });
      entries = timelineEntries();
      const last = entries[entries.length - 1] || {};
      expect((last as any)?.collectedAmount).toBeUndefined();
    });

    it('paid-return never settles (RETURN_PENDING, never DELIVERED)', async () => {
      await service.handleCarrybee({
        event: 'order.paid-return',
        consignment_id: 'CG-1',
        collected_amount: 60,
      });
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'RETURN_PENDING' }),
        }),
      );
    });
  });

  describe('extras (f) — create-failed: no dispatch + record + alert', () => {
    it('without an optimistic record: recorded, NO dispatch created', async () => {
      prisma.dispatch.findFirst.mockResolvedValue(null);
      const errSpy = jest.spyOn((service as any).logger, 'error');
      const result = await service.handleCarrybee({
        event: 'order.create-failed',
        merchant_order_id: 'INV-1',
        reason: 'bad phone',
        causes: { recipient_phone: [{ type: 'required' }] },
      });
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(prisma.dispatch.update).not.toHaveBeenCalled();
      const entries = timelineEntries();
      expect(entries.length).toBeGreaterThan(0);
      expect(errSpy.mock.calls.length).toBeGreaterThan(0);
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('with an optimistic record: that record goes CANCELLED', async () => {
      prisma.dispatch.findFirst.mockResolvedValue({ id: 'd-opt', status: 'DISPATCHED' });
      const result = await service.handleCarrybee({
        event: 'order.create-failed',
        merchant_order_id: 'INV-1',
        reason: 'bad phone',
      });
      expect(result.status).toBe('success');
      expect(prisma.dispatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd-opt' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
    });
  });

  describe('extras (g) — unlisted transfer_status → null + keep', () => {
    it('mapper returns null for unlisted labels (never forced)', () => {
      expect(
        mapCourierStatusToDispatchStatus('carrybee', 'some-unlisted-xyz-status'),
      ).toBeNull();
      expect(mapCourierStatusToDispatchStatus('pathao', 'some-unlisted-xyz-status')).toBeNull();
    });
  });
});
