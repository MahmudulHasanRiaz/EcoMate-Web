import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierManagerService } from './courier-manager.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { ReturnsService } from '../returns/returns.service';

/**
 * Sheet conformance 2026-10-23 (Rules 2 / 25 / 27b):
 * - Courier partial-return signals NEVER auto-create a Return — the courier
 *   never reports which items/qty came back. With an active Return they LINK
 *   it and move the stage to DELIVERED; with none they HOLD + staff alert.
 * - Courier back-with-merchant signals NEVER receive and NEVER restock: the
 *   Return stage is DELIVERED (not RECEIVED); stock is staff-receive-only.
 * - single-parcel return_list_accepted is LINK-only (consignment_id only).
 * - FULL unchanged.
 */
describe('CourierWebhookService — T6 partial restore-or-hold', () => {
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

  function timelineRemarks(): string[] {
    return timelineEntries().map((e) => String((e as any)?.remarks || ''));
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
      upsertCourierReturn: jest.fn().mockResolvedValue({ id: 'ret-courier-1', status: 'REQUESTED' }),
      setReturnTransit: jest.fn().mockResolvedValue({ id: 'ret-courier-1', status: 'IN_TRANSIT' }),
      recordCourierParcelBack: jest.fn().mockResolvedValue({ id: 'ret-courier-1', status: 'REQUESTED' }),
      restockReturn: jest.fn().mockResolvedValue({ id: 'ret-staff-1', status: 'RESTOCKED' }),
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
        { provide: ReturnsService, useValue: returns },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('partial received — active Return exists (linked, stage delivered)', () => {
    it('records the courier signal only — a staff member must receive it (no auto-restore)', async () => {
      returns.upsertCourierReturn.mockResolvedValue({
        id: 'ret-staff-1',
        displayId: 'RTN-260101-0007',
        status: 'REQUESTED',
      });
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'partial_delivered_return_received',
      });

      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'PARTIAL',
          returnStatus: 'DELIVERED',
          stockReconciled: false,
        }),
      );
      // Stage only: the courier delivered the return to us — we have NOT
      // received it, so nothing restocks and no actor is invented.
      expect(returns.recordCourierParcelBack).toHaveBeenCalledWith(
        'ret-staff-1',
        'partial_delivered_return_received',
      );
      expect(returns.restockReturn).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
      const remarks = timelineRemarks().join('\n');
      expect(remarks).toMatch(/awaiting staff receive/i);
      expect(remarks).not.toMatch(/stock reconciled/i);
    });
  });

  describe('partial received — NO active Return (never auto-created)', () => {
    it('HOLDS with LOUD staff alert and never prints stock reconciled', async () => {
      returns.upsertCourierReturn.mockResolvedValue(null);
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'partial_delivered_return_received',
      });

      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'PARTIAL',
          returnStatus: 'HELD',
          stockReconciled: false,
        }),
      );
      // NEVER auto-created (sheet Rule 27b) and never received.
      expect(returns.recordCourierParcelBack).not.toHaveBeenCalled();
      expect(returns.restockReturn).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
      const remarks = timelineRemarks().join('\n');
      expect(remarks).toMatch(/HOLD \+ staff alert/i);
      expect(remarks).toMatch(/NO Return exists/i);
      expect(remarks).not.toMatch(/stock reconciled/);
    });

    it('asks for a PARTIAL link-only upsert (createIfMissing is never implied)', async () => {
      returns.upsertCourierReturn.mockResolvedValue(null);
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'partial_delivered_return_received',
      });

      await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      const call = returns.upsertCourierReturn.mock.calls[0][0];
      expect(call).toEqual(
        expect.objectContaining({
          orderId: 'order-1',
          courier: 'steadfast',
          type: 'PARTIAL',
        }),
      );
      // PARTIAL can never create: the flag is never explicitly true.
      expect(call.createIfMissing).not.toBe(true);
    });
  });

  describe('single-parcel return_list_accepted', () => {
    it('links one Return for a consignment_id-only payload', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'return_list_accepted',
        consignment_id: 'CG-1',
        return_list_id: 'RL-5',
        status: 'accepted',
      });

      expect(result.status).toBe('success');
      expect(returns.upsertCourierReturn).toHaveBeenCalledTimes(1);
      expect(returns.upsertCourierReturn).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', courierReturnId: 'RL-5' }),
      );
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      const entries = timelineEntries();
      expect(entries.find((e) => (e as any)?.returnListId === 'RL-5')).toBeDefined();
    });
  });

  describe('FULL unchanged', () => {
    it('cancelled received records the courier signal only (no auto-restore)', async () => {
      manager.getSteadfastReturnStatus.mockResolvedValue({
        deliveryStatus: 'cancelled_return_received',
      });

      const result = await service.reconcileSteadfastReturn({ consignmentId: 'CG-1' });

      expect(result).toEqual(
        expect.objectContaining({
          reconciled: true,
          dispatchStatus: 'RETURN_PENDING',
          returnStatus: 'DELIVERED',
          stockReconciled: false,
        }),
      );
      expect(returns.restockReturn).not.toHaveBeenCalled();
      // The timeline must NOT claim the stock was reconciled — nothing was
      // restored until a staff member receives the return.
      const remarks = timelineRemarks().join('\n');
      expect(remarks).not.toMatch(/stock reconciled/i);
      expect(remarks).toMatch(/awaiting staff receive/i);
    });
  });
});
