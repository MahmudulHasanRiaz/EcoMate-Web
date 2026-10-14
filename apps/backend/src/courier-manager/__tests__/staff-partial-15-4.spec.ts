import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from '../courier-webhook.service';
import { CourierManagerService } from '../courier-manager.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { ReturnsService } from '../../returns/returns.service';

/**
 * Task 5 (Fix 9, owner-locked Rule 15.4): Partial→Delivered exception in
 * tryAdvanceOrderStatus.
 *
 * - Staff-created Return exists + CONFIRMED partial-delivered arrives + NO
 *   instant-delivery marked (order still Partial, not Delivered) → allow
 *   Partial→Delivered (explicit exception to the flow-index block).
 * - Instant-delivery marked → already Delivered → webhook no-op.
 * - Approval-pending partial → NEVER Delivers (lock).
 * - Delivered + later partial webhook → stays Delivered (lock, incl. the
 *   staff-Return case).
 * - Partial amount collection ONLY if definite (locks existing behavior).
 */
describe('CourierWebhookService — staff-partial 15.4 exception (Task 5 Fix 9)', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;

  const partialOrder = {
    id: 'order-1',
    status: { id: 'status-partial', name: 'Partial' },
    timeline: [],
    courierStatus: 'partial_delivered',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'ORD-1',
    courierService: 'steadfast',
  };
  const deliveredOrder = {
    ...partialOrder,
    status: { id: 'status-delivered', name: 'Delivered' },
  };
  const shippingOrder = {
    ...partialOrder,
    status: { id: 'status-shipping', name: 'Shipping' },
  };

  const partialStatus = { id: 'status-partial', name: 'Partial' };
  const deliveredStatus = { id: 'status-delivered', name: 'Delivered' };

  function timelineEntries(): any[] {
    const calls = prisma.order.update.mock.calls as any[];
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
      confirmStaffPartialDelivered: jest.fn().mockResolvedValue({
        id: 'order-1',
        status: deliveredStatus,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: { getSteadfastReturnStatus: jest.fn() } },
        { provide: CancelReturnStockService, useValue: { restoreForOrder: jest.fn() } },
        {
          provide: ReturnsService,
          useValue: { upsertCourierReturn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('staff-first sequence (Shipping → Partial → confirmed partial → Delivered)', () => {
    it('steadfast CONFIRMED partial on a staff-Partial order promotes via 15.4 (dispatch still PARTIAL)', async () => {
      prisma.order.findFirst.mockResolvedValue(partialOrder);
      prisma.order.findUnique.mockResolvedValue(partialOrder);

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'partial_delivered',
      });

      expect(result.status).toBe('success');
      // Dispatch keeps tracking the courier automatically…
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      // …and the 15.4 exception promotes the order (the ONLY automated
      // Partial→Delivered path).
      expect(ordersService.confirmStaffPartialDelivered).toHaveBeenCalledWith(
        'order-1',
        'system',
      );
    });

    it('pathao confirmed partial on a staff-Partial order promotes via 15.4', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...partialOrder,
        courierService: 'pathao',
      });
      prisma.order.findUnique.mockResolvedValue(partialOrder);

      await service.handlePathao({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
      });

      expect(ordersService.confirmStaffPartialDelivered).toHaveBeenCalledWith(
        'order-1',
        'system',
      );
    });

    it('courier-first confirmed partial on Shipping (no staff Return yet) takes the normal path, NOT 15.4', async () => {
      prisma.order.findFirst.mockResolvedValue(shippingOrder);
      prisma.order.findUnique.mockResolvedValue(shippingOrder);

      await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'partial_delivered',
      });

      expect(ordersService.confirmStaffPartialDelivered).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });
  });

  describe('approval-pending partial NEVER Delivers', () => {
    it('steadfast approval-pending on a staff-Partial order stays Partial (dispatch PARTIAL, no promotion)', async () => {
      prisma.order.findFirst.mockResolvedValue(partialOrder);
      prisma.order.findUnique.mockResolvedValue(partialOrder);

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'partial_delivered_approval_pending',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      expect(ordersService.confirmStaffPartialDelivered).not.toHaveBeenCalled();
      // Order status write never happens (stays Partial).
      for (const call of (prisma.order.update as jest.Mock).mock.calls) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });
  });

  describe('15.4 fail-closed: promotion failure keeps the lock', () => {
    it('a Partial order with NO staff Return stays Partial (confirm rejects → no throw)', async () => {
      prisma.order.findFirst.mockResolvedValue(partialOrder);
      prisma.order.findUnique.mockResolvedValue(partialOrder);
      ordersService.confirmStaffPartialDelivered.mockRejectedValue(
        new Error('Partial → Delivered requires an open staff-created partial return.'),
      );

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'partial_delivered',
      });

      expect(result.status).toBe('success');
      for (const call of (prisma.order.update as jest.Mock).mock.calls) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });
  });

  describe('instant-delivery variant + Delivered→Partial LOCK', () => {
    it('instant-delivery (already Delivered) + later partial webhook → no-op, stays Delivered', async () => {
      prisma.order.findFirst.mockResolvedValue(deliveredOrder);
      prisma.order.findUnique.mockResolvedValue(deliveredOrder);

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'partial_delivered',
      });

      expect(result.status).toBe('success');
      expect(ordersService.confirmStaffPartialDelivered).not.toHaveBeenCalled();
      // Dispatch still tracks the courier…
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      // …but the ORDER never moves (stays Delivered).
      for (const call of (prisma.order.update as jest.Mock).mock.calls) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });

    it('Delivered order WITH a staff Return + later partial webhook → stays Delivered (lock covers staff case)', async () => {
      prisma.order.findFirst.mockResolvedValue(deliveredOrder);
      prisma.order.findUnique.mockResolvedValue(deliveredOrder);
      ordersService.updateStatus.mockRejectedValue(
        new Error('Cannot transition from "Delivered" to "Partial". Allowed: Return Pending'),
      );

      const result = await service.handlePathao({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
      });

      expect(result.status).toBe('success');
      expect(ordersService.confirmStaffPartialDelivered).not.toHaveBeenCalled();
      for (const call of (prisma.order.update as jest.Mock).mock.calls) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });
  });

  describe('Partial amount collection ONLY if definite (existing behavior lock)', () => {
    it('pathao partial-delivery with a definite collected_amount records it', async () => {
      prisma.order.findFirst.mockResolvedValue(shippingOrder);
      prisma.order.findUnique.mockResolvedValue(shippingOrder);

      await service.handlePathao({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
        collected_amount: 500,
      });

      const entries = timelineEntries();
      expect(JSON.stringify(entries)).toContain('500');
    });

    it('pathao partial-delivery with a non-definite collected_amount records nothing', async () => {
      prisma.order.findFirst.mockResolvedValue(shippingOrder);
      prisma.order.findUnique.mockResolvedValue(shippingOrder);

      await service.handlePathao({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
        collected_amount: 'abc',
      });

      const entries = timelineEntries();
      const last = entries[entries.length - 1] || {};
      expect((last as any)?.collectedAmount).toBeUndefined();
    });

    it('carrybee partial-delivery with a definite collected_amount records it', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...shippingOrder,
        courierService: 'carrybee',
      });
      prisma.order.findUnique.mockResolvedValue(shippingOrder);

      await service.handleCarrybee({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
        collected_amount: 770,
      });

      const entries = timelineEntries();
      expect(JSON.stringify(entries)).toContain('770');
    });
  });
});
