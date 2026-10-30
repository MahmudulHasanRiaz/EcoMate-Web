import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from '../courier-webhook.service';
import { CourierManagerService } from '../courier-manager.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { CodMismatchService } from '../../cod-mismatch/cod-mismatch.service';
import { mapCourierStatusToDispatchStatus } from '../courier-status-mapper';
import { DispatchService } from '../../dispatch/dispatch.service';
import { OrderStockDeductService } from '../../stock/order-stock-deduct.service';
import { CourierTrackingService } from '../courier-tracking.service';
import { impliesPickup } from '../../dispatch/dispatch-timestamps';

/**
 * Task 3 / Fix 7 (courier FINAL follow-up, owner-locked):
 * - order.pickup-failed (Pathao + Carrybee) → PICKUP_FAILED: record attempt +
 *   reason + alert; staff can retry/update the same dispatch. ORDER STATUS:
 *   unchanged — owner ruling 2026-10-30 supersedes F7's "order Shipping".
 * - order.received-at-last-mile-hub (Pathao + Carrybee) → ASSIGNED_TO_HUB,
 *   order Shipping. ASSIGNED_TO_RIDER is then ONLY for assigned-for-delivery.
 * - order.delivery-failed stays record-only (both couriers) — locked here.
 *
 * RED first: every CHANGE assertion must FAIL before the fix; every LOCK
 * assertion must PASS before and after.
 */
describe('Courier Task 3 — PICKUP_FAILED + ASSIGNED_TO_HUB states', () => {
  let webhook: CourierWebhookService;
  let prisma: any;
  let ordersService: any;

  const packedOrder = {
    id: 'order-1',
    status: { id: 'status-packed', name: 'Packed' },
    timeline: [],
    courierStatus: 'shipping',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'INV-1',
    courierService: 'pathao',
  };

  const shippingStatus = { id: 'status-shipping', name: 'Shipping' };

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(packedOrder),
        findUnique: jest.fn().mockResolvedValue(packedOrder),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        {
          provide: CourierManagerService,
          useValue: { getSteadfastReturnStatus: jest.fn() },
        },
        {
          provide: CancelReturnStockService,
          useValue: { restoreForOrder: jest.fn() },
        },
        { provide: CodMismatchService, useValue: {} },
      ],
    }).compile();

    webhook = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('sync mapper — BOTH maps (pathao + carrybee)', () => {
    it.each(['pathao', 'carrybee'])(
      'order.pickup-failed → PICKUP_FAILED (%s)',
      (courier) => {
        expect(
          mapCourierStatusToDispatchStatus(courier, 'order.pickup-failed'),
        ).toBe('PICKUP_FAILED');
      },
    );

    it.each(['pathao', 'carrybee'])(
      'order.received-at-last-mile-hub → ASSIGNED_TO_HUB (%s)',
      (courier) => {
        expect(
          mapCourierStatusToDispatchStatus(
            courier,
            'order.received-at-last-mile-hub',
          ),
        ).toBe('ASSIGNED_TO_HUB');
      },
    );

    it.each(['pathao', 'carrybee'])(
      'order.assigned-for-delivery stays ASSIGNED_TO_RIDER (%s)',
      (courier) => {
        expect(
          mapCourierStatusToDispatchStatus(
            courier,
            'order.assigned-for-delivery',
          ),
        ).toBe('ASSIGNED_TO_RIDER');
      },
    );

    // LOCK: delivery-failed stays record-only (null) in both maps.
    it.each(['pathao', 'carrybee'])(
      'order.delivery-failed stays null (%s)',
      (courier) => {
        expect(
          mapCourierStatusToDispatchStatus(courier, 'order.delivery-failed'),
        ).toBeNull();
      },
    );
  });

  describe('Pathao webhook — hub event', () => {
    it('order.received-at-last-mile-hub → ASSIGNED_TO_HUB + order Shipping', async () => {
      const result = await webhook.handlePathao({
        event: 'order.received-at-last-mile-hub',
        consignment_id: 'CG-1',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'ASSIGNED_TO_HUB' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-shipping' },
        'system',
      );
    });
  });

  describe('Carrybee webhook — hub event', () => {
    it('order.received-at-last-mile-hub → ASSIGNED_TO_HUB + order Shipping', async () => {
      const result = await webhook.handleCarrybee({
        event: 'order.received-at-last-mile-hub',
        consignment_id: 'CG-1',
        merchant_order_id: 'INV-1',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'ASSIGNED_TO_HUB' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-shipping' },
        'system',
      );
    });
  });

  describe('delivery-failed record-only LOCK (both couriers)', () => {
    it('Pathao delivery-failed: raw recorded, NO dispatch write, NO order advance', async () => {
      const result = await webhook.handlePathao({
        event: 'order.delivery-failed',
        consignment_id: 'CG-1',
        reason: 'Customer not reachable',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
      const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0];
      expect(orderUpdate[0].data.courierStatus).toBe('order.delivery-failed');
    });

    it('Carrybee delivery-failed: attempt recorded, NO dispatch write, NO order advance', async () => {
      const result = await webhook.handleCarrybee({
        event: 'order.delivery-failed',
        consignment_id: 'CG-1',
        merchant_order_id: 'INV-1',
        attempt: 2,
        reason: 'Gate closed',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('cancel-with-progress — hub counts as progress, failed pickup does not', () => {
    it('Pathao pickup-cancelled on an ASSIGNED_TO_HUB dispatch → RETURN_PENDING', async () => {
      // Faithful DB simulation: the order owns ONE dispatch row at
      // ASSIGNED_TO_HUB. The progress query matches it ONLY when its
      // `in:` list contains ASSIGNED_TO_HUB (else the real DB returns null).
      prisma.dispatch.findFirst.mockImplementation((args: any) => {
        const wanted: string[] = args?.where?.status?.in || [];
        if (wanted.length > 0) {
          if (wanted.includes('ASSIGNED_TO_HUB'))
            return Promise.resolve({ id: 'd-hub' });
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
      prisma.orderStatus.findUnique.mockImplementation(({ where }: any) => {
        if (where?.name === 'Shipping') return Promise.resolve(shippingStatus);
        if (where?.name === 'Return Pending')
          return Promise.resolve({ id: 'status-rp', name: 'Return Pending' });
        return Promise.resolve(null);
      });

      const result = await webhook.handlePathao({
        event: 'order.pickup-cancelled',
        consignment_id: 'CG-1',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'RETURN_PENDING' }),
        }),
      );
    });

    it('Pathao pickup-cancelled on a PICKUP_FAILED dispatch → CANCELLED (no progress)', async () => {
      prisma.dispatch.findFirst.mockResolvedValue(null);

      const result = await webhook.handlePathao({
        event: 'order.pickup-cancelled',
        consignment_id: 'CG-1',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });
  });

  describe('pickup timestamps — hub implies pickup, failure does not', () => {
    it('ASSIGNED_TO_HUB implies pickup (parcel reached the last-mile hub)', () => {
      expect(impliesPickup('ASSIGNED_TO_HUB')).toBe(true);
    });

    it('PICKUP_FAILED never implies pickup', () => {
      expect(impliesPickup('PICKUP_FAILED')).toBe(false);
    });
  });
});

describe('Courier Task 3 — manual-board transitions + sync order mapping', () => {
  let service: DispatchService;
  let prisma: any;
  let ordersService: any;

  function mockClaimed(fromStatus: string) {
    prisma.dispatch.findUnique.mockResolvedValueOnce({
      id: 'd-1',
      status: fromStatus,
      orderId: 'order-1',
      courier: 'pathao',
      pickedUpAt: null,
      deliveredAt: null,
    });
    prisma.dispatch.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.dispatch.findUnique.mockResolvedValueOnce({
      id: 'd-1',
      orderId: 'order-1',
      status: 'IGNORED',
      courier: 'pathao',
      consignmentId: 'CG-001',
      productMapping: null,
    });
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    prisma.order = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { name: 'Packed' },
        timeline: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.orderStatus = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'status-shipping',
        name: 'Shipping',
      }),
    };
  }

  beforeEach(async () => {
    prisma = {
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'd-1' }),
        update: jest.fn().mockResolvedValue({ id: 'd-1' }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatus: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      courierDispatchLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    ordersService = {
      updateStatus: jest.fn().mockResolvedValue({}),
      fireOrderStatusLifecycleEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CourierManagerService,
          useValue: { getCollectableAmount: jest.fn().mockReturnValue(750) },
        },
        {
          provide: CancelReturnStockService,
          useValue: {
            holdReservationForReturnPending: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: OrderStockDeductService,
          useValue: { deductForOrder: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CourierTrackingService,
          useValue: { getDispatchTracking: jest.fn().mockResolvedValue(null) },
        },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();

    service = module.get<DispatchService>(DispatchService);
  });

  it('staff can mark DISPATCHED → PICKUP_FAILED and retry PICKUP_FAILED → PICKED_UP', async () => {
    mockClaimed('DISPATCHED');
    await service.updateStatus('d-1', 'PICKUP_FAILED', 'staff-123');
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PICKUP_FAILED' }),
      }),
    );

    mockClaimed('PICKUP_FAILED');
    await service.updateStatus('d-1', 'PICKED_UP', 'staff-123');
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PICKED_UP' }),
      }),
    );
  });

  it('IN_TRANSIT → ASSIGNED_TO_HUB → ASSIGNED_TO_RIDER walks forward', async () => {
    mockClaimed('IN_TRANSIT');
    await service.updateStatus('d-1', 'ASSIGNED_TO_HUB', 'staff-123');
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ASSIGNED_TO_HUB' }),
      }),
    );

    mockClaimed('ASSIGNED_TO_HUB');
    await service.updateStatus('d-1', 'ASSIGNED_TO_RIDER', 'staff-123');
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ASSIGNED_TO_RIDER' }),
      }),
    );
  });

  it('PICKUP_FAILED does NOT move the order (owner ruling 2026-10-30)', async () => {
    mockClaimed('DISPATCHED');
    await service.updateStatus('d-1', 'PICKUP_FAILED', 'staff-123');
    // The dispatch itself still becomes PICKUP_FAILED…
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PICKUP_FAILED' }),
      }),
    );
    // …but the order is never advanced to Shipping: the parcel never left,
    // so the order keeps whatever status it had.
    const orderUpdates = (prisma.order.update as jest.Mock).mock.calls;
    expect(
      orderUpdates.some((c: any) => c[0]?.data?.statusId === 'status-shipping'),
    ).toBe(false);
  });

  it('ASSIGNED_TO_HUB advances the order to Shipping (sync map)', async () => {
    mockClaimed('IN_TRANSIT');
    await service.updateStatus('d-1', 'ASSIGNED_TO_HUB', 'staff-123');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({ statusId: 'status-shipping' }),
      }),
    );
  });
});
