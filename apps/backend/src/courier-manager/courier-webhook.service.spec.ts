import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CourierWebhookService } from './courier-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

/**
 * AUTHORITATIVE BUSINESS RULE (PARTIAL):
 *  - Rule A: PARTIAL from ANY courier → order becomes 'Partial' automatically.
 *  - Rule B: 'Partial' is automation-stopped — no webhook, replay, courier
 *    sync or reconciliation may move it; only manual staff action may.
 */
describe('CourierWebhookService — PARTIAL rules', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;

  const order = {
    id: 'order-1',
    status: { id: 'status-shipping', name: 'Shipping' },
    courierStatus: 'shipping',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'INV-1',
    courierService: 'redx',
  };

  const partialStatus = { id: 'status-partial', name: 'Partial' };
  const deliveredStatus = { id: 'status-delivered', name: 'Delivered' };

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(order),
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockResolvedValue(partialStatus),
      },
      dispatch: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      courierDispatchLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      courierWebhookLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    ordersService = {
      updateStatus: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  describe('Rule A — PARTIAL from any courier advances the order to Partial', () => {
    it('Steadfast partial_delivered → dispatch PARTIAL → order Partial', async () => {
      prisma.orderStatus.findUnique.mockResolvedValue(partialStatus);

      const result = await service.handleSteadfast({
        notification_type: 'status_change',
        consignment_id: 'CG-1',
        status: 'partial_delivered',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });

    it('Steadfast partial_delivered_approval_pending → dispatch PARTIAL too (official docs)', async () => {
      prisma.orderStatus.findUnique.mockResolvedValue(partialStatus);

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
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });

    it('Steadfast unknown_approval_pending is skipped (no forced status)', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'unknown_approval_pending',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('Steadfast delivered_approval_pending keeps the dispatch at rider stage', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'delivered_approval_pending',
      });

      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'ASSIGNED_TO_RIDER' }),
        }),
      );
    });

    it('Pathao order.partial-delivery → dispatch PARTIAL → order Partial', async () => {
      prisma.orderStatus.findUnique.mockResolvedValue(partialStatus);

      await service.handlePathao({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
      });

      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });

    it('RedX delivered + partial-delivery delivery type → dispatch PARTIAL → order Partial', async () => {
      prisma.orderStatus.findUnique.mockResolvedValue(partialStatus);

      await service.handleRedx({
        tracking_number: 'TN-1',
        invoice_number: 'INV-1',
        status: 'delivered',
        delivery_type: 'partial-delivery',
        message_en: 'Partially delivered',
      });

      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });

    it('RedX raw partial status → dispatch PARTIAL → order Partial', async () => {
      prisma.orderStatus.findUnique.mockResolvedValue(partialStatus);

      await service.handleRedx({
        tracking_number: 'TN-1',
        status: 'partial',
      });

      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });

    it('Carrybee order.partial-delivery → dispatch PARTIAL → order Partial', async () => {
      prisma.orderStatus.findUnique.mockResolvedValue(partialStatus);

      await service.handleCarrybee({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
      });

      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { statusId: 'status-partial' },
        'system',
      );
    });
  });

  describe('Order resolution — Steadfast webhook', () => {
    it('primary lookup by order.courierConsignmentId still wins', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'delivered',
      });

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courierConsignmentId: 'CG-1',
            trashedAt: null,
          }),
        }),
      );
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalled();
      // Primary hit → fallback lookups are never executed
      expect(prisma.dispatch.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the Dispatch registry when Order.courierConsignmentId is unset (manual dispatch)', async () => {
      prisma.order.findFirst.mockResolvedValueOnce(null); // order column miss
      prisma.dispatch.findFirst.mockResolvedValueOnce({
        orderId: 'order-1',
      });
      prisma.order.findUnique.mockResolvedValueOnce(order);
      prisma.orderStatus.findUnique.mockResolvedValue(deliveredStatus);

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        status: 'delivered',
      });

      expect(prisma.dispatch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courier: 'steadfast',
            consignmentId: 'CG-1',
          }),
        }),
      );
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('falls back to the documented invoice identifier (order.displayId)', async () => {
      prisma.order.findFirst
        .mockResolvedValueOnce(null) // order.courierConsignmentId miss
        .mockResolvedValueOnce(order); // invoice → displayId hit
      prisma.dispatch.findFirst.mockResolvedValue(null); // no dispatch row
      prisma.orderStatus.findUnique.mockResolvedValue(deliveredStatus);

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'CG-1',
        invoice: 'INV-1',
        status: 'delivered',
      });

      // invoice lookup is the 2nd order.findFirst call (primary miss → invoice hit)
      expect(prisma.order.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            displayId: 'INV-1',
            courierService: 'steadfast',
          }),
        }),
      );
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalled();
    });

    it('trims whitespace from consignment_id before lookup', async () => {
      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: '  CG-1  ',
        status: 'delivered',
      });

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ courierConsignmentId: 'CG-1' }),
        }),
      );
      expect(result.status).toBe('success');
    });

    it('returns Order not found only when every source misses', async () => {
      prisma.order.findFirst.mockResolvedValue(null); // consignment + invoice miss
      prisma.dispatch.findFirst.mockResolvedValue(null);

      const result = await service.handleSteadfast({
        notification_type: 'delivery_status',
        consignment_id: 'UNKNOWN-99',
        invoice: 'INV-MISSING',
        status: 'delivered',
      });

      expect(result).toEqual({ status: 'error', message: 'Order not found' });
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('Order resolution — Pathao webhook', () => {
    const pathaoOrder = {
      id: 'order-1',
      status: { id: 'status-pending', name: 'Shipping' },
      courierConsignmentId: 'P-CG-1',
      displayId: 'INV-1',
      courierService: 'pathao',
    };

    it('primary lookup by order.courierConsignmentId still wins', async () => {
      prisma.order.findFirst.mockResolvedValue(pathaoOrder);
      prisma.dispatch.findFirst.mockResolvedValue(null);
      prisma.orderStatus.findUnique.mockResolvedValue(deliveredStatus);

      const result = await service.handlePathao({
        event: 'order.delivered',
        consignment_id: 'P-CG-1',
      });

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courierConsignmentId: 'P-CG-1',
            trashedAt: null,
          }),
        }),
      );
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalled();
      // Primary hit → fallback lookups are never executed
      expect(prisma.dispatch.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the Dispatch registry when Order.courierConsignmentId is unset (manual dispatch list)', async () => {
      prisma.order.findFirst.mockResolvedValueOnce(null); // order column miss
      prisma.dispatch.findFirst.mockResolvedValueOnce({
        orderId: 'order-1',
      });
      prisma.order.findUnique.mockResolvedValueOnce(order);
      prisma.orderStatus.findUnique.mockResolvedValue(deliveredStatus);

      const result = await service.handlePathao({
        event: 'order.delivered',
        consignment_id: 'P-CG-9',
      });

      expect(prisma.dispatch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courier: 'pathao',
            consignmentId: 'P-CG-9',
          }),
        }),
      );
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('falls back to the documented merchant_order_id (order.displayId)', async () => {
      prisma.order.findFirst
        .mockResolvedValueOnce(null) // order.courierConsignmentId miss
        .mockResolvedValueOnce(pathaoOrder); // merchant_order_id → displayId hit
      prisma.dispatch.findFirst.mockResolvedValue(null); // no dispatch row
      prisma.orderStatus.findUnique.mockResolvedValue(deliveredStatus);

      const result = await service.handlePathao({
        event: 'order.delivered',
        consignment_id: 'P-CG-9',
        merchant_order_id: 'INV-1',
      });

      expect(prisma.order.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            displayId: 'INV-1',
            courierService: 'pathao',
          }),
        }),
      );
      expect(result.status).toBe('success');
      expect(prisma.dispatch.upsert).toHaveBeenCalled();
    });

    it('returns Order not found only when every source misses (incl. no merchant_order_id)', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.dispatch.findFirst.mockResolvedValue(null);

      const result = await service.handlePathao({
        event: 'order.delivered',
        consignment_id: 'UNKNOWN-99',
      });

      expect(result).toEqual({ status: 'error', message: 'Order not found' });
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('Pathao skip-statuses record raw state without forcing a workflow change', () => {
    beforeEach(() => {
      // The "all sources miss" test above leaves findFirst → null; the raw
      // record path needs the order resolvable.
      prisma.order.findFirst.mockResolvedValue(order);
    });

    it('order.pickup-failed: records courierStatus + timeline, never cancels the dispatch', async () => {
      const result = await service.handlePathao({
        event: 'order.pickup-failed',
        consignment_id: 'CG-1',
      });

      expect(result.status).toBe('success');
      // Order courier status recorded verbatim…
      const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0];
      expect(orderUpdate[0].data.courierStatus).toBe('order.pickup-failed');
      // …touched in before they existed? dispatch.upsert must not carry a
      // status change (no CANCELLED / no forced status).
      const upsertCalls = (prisma.dispatch.upsert as jest.Mock).mock.calls;
      if (upsertCalls.length > 0) {
        expect(upsertCalls[0][0].update.status).toBeUndefined();
      }
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('order.delivery-failed: records courierStatus + timeline, never forces RETURN_PENDING', async () => {
      const result = await service.handlePathao({
        event: 'order.delivery-failed',
        consignment_id: 'CG-1',
        reason: 'Customer not reachable',
      });

      expect(result.status).toBe('success');
      const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0];
      expect(orderUpdate[0].data.courierStatus).toBe('order.delivery-failed');
      const upsertCalls = (prisma.dispatch.upsert as jest.Mock).mock.calls;
      if (upsertCalls.length > 0) {
        expect(upsertCalls[0][0].update.status).toBeUndefined();
      }
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });

    it('order.updated (informational) is recorded the same way', async () => {
      const result = await service.handlePathao({
        event: 'order.updated',
        consignment_id: 'CG-1',
      });

      expect(result.status).toBe('success');
      const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0];
      expect(orderUpdate[0].data.courierStatus).toBe('order.updated');
      expect(ordersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('Rule B — Partial order is automation-stopped', () => {
    it('a Delivered webhook on a Partial order locks the ORDER but still updates the DISPATCH (Steadfast)', async () => {
      // Order is already Partial; the OrdersService lock rejects the advance.
      prisma.order.findFirst.mockResolvedValue({
        ...order,
        status: { id: 'status-partial', name: 'Partial' },
      });
      prisma.orderStatus.findUnique.mockResolvedValue(deliveredStatus);
      ordersService.updateStatus.mockRejectedValue(
        new BadRequestException(
          'Order is Partial: automated processes cannot change its status. It must be changed manually.',
        ),
      );

      const result = await service.handleSteadfast({
        notification_type: 'status_change',
        consignment_id: 'CG-1',
        status: 'delivered',
      });

      expect(result.status).toBe('success');
      // ORDER status must never move…
      const orderUpdates = (prisma.order.update as jest.Mock).mock.calls;
      for (const call of orderUpdates) {
        expect(call[0].data.statusId).toBeUndefined();
      }
      // …but the DISPATCH status keeps tracking the courier automatically.
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

    it('a Returned webhook replay on a Partial order never transitions it (Pathao)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...order,
        status: { id: 'status-partial', name: 'Partial' },
      });
      ordersService.updateStatus.mockRejectedValue(
        new BadRequestException('lock'),
      );

      await service.handlePathao({
        event: 'order.returned',
        consignment_id: 'CG-1',
      });

      const orderUpdates = (prisma.order.update as jest.Mock).mock.calls;
      for (const call of orderUpdates) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });

    it('a Cancelled webhook on a Partial order never transitions it (RedX)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...order,
        status: { id: 'status-partial', name: 'Partial' },
      });
      ordersService.updateStatus.mockRejectedValue(
        new BadRequestException('lock'),
      );

      await service.handleRedx({
        tracking_number: 'TN-1',
        status: 'cancelled',
      });

      const orderUpdates = (prisma.order.update as jest.Mock).mock.calls;
      for (const call of orderUpdates) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });

    it('a PARTIAL replay on a Partial order is a no-op for order status (Carrybee)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...order,
        status: { id: 'status-partial', name: 'Partial' },
      });
      prisma.orderStatus.findUnique.mockResolvedValue(partialStatus);
      ordersService.updateStatus.mockRejectedValue(
        new BadRequestException('lock'),
      );

      await service.handleCarrybee({
        event: 'order.partial-delivery',
        consignment_id: 'CG-1',
      });

      const orderUpdates = (prisma.order.update as jest.Mock).mock.calls;
      for (const call of orderUpdates) {
        expect(call[0].data.statusId).toBeUndefined();
      }
    });
  });
});