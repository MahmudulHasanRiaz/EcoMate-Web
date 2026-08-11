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