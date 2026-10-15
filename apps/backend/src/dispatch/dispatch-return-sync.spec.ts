import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourierTrackingService } from '../courier-manager/courier-tracking.service';
import { CourierManagerService } from '../courier-manager/courier-manager.service';
import { CourierWebhookService } from '../courier-manager/courier-webhook.service';
import { OrdersService } from '../orders/orders.service';
import { OrderStockDeductService } from '../stock/order-stock-deduct.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';

/**
 * Task 6 (Fix 13): manual-sync trigger — a manual "Sync Status from Courier"
 * on a return-ish dispatch (RETURN_PENDING / RETURNED / PARTIAL) calls the
 * Steadfast return-status reconcile (the ONLY endpoint that reports how far
 * back a parcel has got) instead of the normal tracking path.
 *
 * - Steadfast + return-ish dispatch → reconcileSteadfastReturn, skip tracking.
 * - Other couriers / non-return dispatches → normal tracking path (unchanged).
 * - Reconcile answering "not a return status" → fall through to normal path.
 * - Reconcile throwing → failed summary entry, no throw, no tracking call.
 */
describe('DispatchService.syncStatusFromCourier — return-status trigger (Task 6)', () => {
  let service: DispatchService;
  let prisma: any;
  let tracking: any;
  let webhooks: any;

  const baseDispatch = {
    id: 'd-1',
    orderId: 'order-1',
    courier: 'steadfast',
    consignmentId: 'CG-1',
    trackingCode: null,
    courierStatus: 'cancelled_return_rider_assigned',
    status: 'RETURN_PENDING',
    pickedUpAt: new Date(),
    order: { id: 'order-1', customer: null, guestPhone: null },
  };

  beforeEach(async () => {
    prisma = {
      dispatch: {
        findMany: jest.fn().mockResolvedValue([{ ...baseDispatch }]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatus: { findUnique: jest.fn().mockResolvedValue(null) },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
    };
    tracking = { getDispatchTracking: jest.fn().mockResolvedValue(null) };
    webhooks = { reconcileSteadfastReturn: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: prisma },
        { provide: CourierTrackingService, useValue: tracking },
        { provide: OrdersService, useValue: { updateStatus: jest.fn() } },
        { provide: OrderStockDeductService, useValue: {} },
        { provide: CancelReturnStockService, useValue: {} },
        { provide: CourierManagerService, useValue: {} },
        { provide: CourierWebhookService, useValue: webhooks },
      ],
    }).compile();

    service = module.get<DispatchService>(DispatchService);
  });

  it('steadfast return-ish dispatch → return-status reconcile, tracking skipped', async () => {
    webhooks.reconcileSteadfastReturn.mockResolvedValue({
      reconciled: true,
      deliveryStatus: 'cancelled_return_rider_assigned',
      dispatchStatus: 'RETURN_PENDING',
    });

    const summary = await service.syncStatusFromCourier(['d-1'], 'staff@x.com');

    expect(webhooks.reconcileSteadfastReturn).toHaveBeenCalledWith({ consignmentId: 'CG-1' });
    expect(tracking.getDispatchTracking).not.toHaveBeenCalled();
    expect(summary.synced).toHaveLength(1);
    expect(summary.failed).toHaveLength(0);
  });

  it.each(['RETURNED', 'PARTIAL'])('triggers on %s dispatches too', async (status) => {
    prisma.dispatch.findMany.mockResolvedValue([{ ...baseDispatch, status }]);
    webhooks.reconcileSteadfastReturn.mockResolvedValue({ reconciled: true, dispatchStatus: status });

    await service.syncStatusFromCourier(['d-1']);

    expect(webhooks.reconcileSteadfastReturn).toHaveBeenCalledWith({ consignmentId: 'CG-1' });
    expect(tracking.getDispatchTracking).not.toHaveBeenCalled();
  });

  it('non-steadfast return-ish dispatch → normal tracking path (no reconcile)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      { ...baseDispatch, courier: 'pathao', status: 'RETURN_PENDING' },
    ]);
    tracking.getDispatchTracking.mockResolvedValue({
      currentStatus: 'order.returned-to-merchant',
      configured: true,
    });

    await service.syncStatusFromCourier(['d-1']);

    expect(webhooks.reconcileSteadfastReturn).not.toHaveBeenCalled();
    expect(tracking.getDispatchTracking).toHaveBeenCalled();
  });

  it('non-return steadfast dispatch → normal tracking path (no reconcile)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([{ ...baseDispatch, status: 'IN_TRANSIT' }]);
    tracking.getDispatchTracking.mockResolvedValue({ currentStatus: 'in_transit', configured: true });

    await service.syncStatusFromCourier(['d-1']);

    expect(webhooks.reconcileSteadfastReturn).not.toHaveBeenCalled();
    expect(tracking.getDispatchTracking).toHaveBeenCalled();
  });

  it('reconcile answering not-a-return-status falls through to normal tracking', async () => {
    webhooks.reconcileSteadfastReturn.mockResolvedValue({
      reconciled: false,
      reason: 'Not a return status — use the normal courier sync for this label',
    });
    tracking.getDispatchTracking.mockResolvedValue({ currentStatus: 'delivered', configured: true });

    await service.syncStatusFromCourier(['d-1']);

    expect(webhooks.reconcileSteadfastReturn).toHaveBeenCalled();
    expect(tracking.getDispatchTracking).toHaveBeenCalled();
  });

  it('reconcile throwing → failed entry, no throw', async () => {
    webhooks.reconcileSteadfastReturn.mockRejectedValue(new Error('courier down'));

    const summary = await service.syncStatusFromCourier(['d-1']);

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({ id: 'd-1' });
    expect(tracking.getDispatchTracking).not.toHaveBeenCalled();
  });
});
