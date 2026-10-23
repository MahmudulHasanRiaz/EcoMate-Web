import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from './courier-webhook.service';
import { CourierManagerService } from './courier-manager.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';

/**
 * Owner directive (2026-10-23): a courier delivery signal must NEVER flip
 * an order (or its dispatch) back to Delivered once the parcel's story
 * includes a return. Deterministic, keyed on facts:
 *  - the Return record (exists + not CLOSED) blocks the order advance;
 *  - a dispatch already in a return state (RETURN_PENDING / RETURNED) is
 *    sticky against delivery-family overwrites and deliveredAt stamps.
 */
describe('CourierWebhookService — return lock on Delivered (2026-10-23)', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let ordersService: any;

  const shippingOrder = {
    id: 'order-1',
    status: { id: 'status-shipping', name: 'Shipping' },
    courierStatus: 'in_transit',
    courierTrackingCode: null,
    courierConsignmentId: 'CG-1',
    displayId: 'ORD-1',
    courierService: 'steadfast',
    trashedAt: null,
    timeline: [],
  };
  const returnedOrder = {
    ...shippingOrder,
    status: { id: 'status-returned', name: 'Returned' },
  };
  const deliveredStatus = { id: 'status-delivered', name: 'Delivered' };

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(shippingOrder),
        findUnique: jest.fn().mockResolvedValue(shippingOrder),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockResolvedValue(deliveredStatus),
      },
      dispatch: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      return: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      courierDispatchLog: { create: jest.fn().mockResolvedValue({}) },
      courierWebhookLog: { create: jest.fn().mockResolvedValue({}) },
    };
    ordersService = { updateStatus: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: CourierManagerService, useValue: { getSteadfastReturnStatus: jest.fn() } },
        { provide: CancelReturnStockService, useValue: { restoreForOrder: jest.fn() } },
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  const deliveredBody = {
    notification_type: 'delivery_status',
    consignment_id: 'CG-1',
    status: 'delivered',
  };

  it('blocks the order advance when a non-CLOSED Return exists (order still Shipping)', async () => {
    prisma.return.findFirst.mockResolvedValue({ id: 'ret-1' });
    const result = await service.handleSteadfast(deliveredBody);
    expect(result.status).toBe('success');
    expect(ordersService.updateStatus).not.toHaveBeenCalled();
  });

  it('blocks the advance for a RECEIVED return too (story completed, staff have not closed it)', async () => {
    prisma.return.findFirst.mockResolvedValue({ id: 'ret-2' });
    await service.handleSteadfast(deliveredBody);
    expect(prisma.return.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: 'order-1', status: { not: 'CLOSED' } }),
      }),
    );
    expect(ordersService.updateStatus).not.toHaveBeenCalled();
  });

  it('control: advances normally when NO Return exists', async () => {
    prisma.return.findFirst.mockResolvedValue(null);
    const result = await service.handleSteadfast(deliveredBody);
    expect(result.status).toBe('success');
    expect(ordersService.updateStatus).toHaveBeenCalledWith(
      'order-1',
      { statusId: 'status-delivered' },
      'system',
    );
  });

  it('dispatch sticky: a RETURN_PENDING dispatch is NOT rewritten to DELIVERED and gets no deliveredAt stamp', async () => {
    prisma.order.findFirst.mockResolvedValue(returnedOrder);
    prisma.order.findUnique.mockResolvedValue(returnedOrder);
    prisma.return.findFirst.mockResolvedValue({ id: 'ret-1' });
    prisma.dispatch.findUnique.mockResolvedValue({ status: 'RETURN_PENDING' });

    const result = await service.handleSteadfast(deliveredBody);
    expect(result.status).toBe('success');

    const upsertArgs = prisma.dispatch.upsert.mock.calls[0][0];
    expect(upsertArgs.update.status).toBe('RETURN_PENDING');
    const stampedDeliveredAt = (prisma.dispatch.updateMany.mock.calls as any[]).some(
      ([args]) => args?.data?.deliveredAt != null,
    );
    expect(stampedDeliveredAt).toBe(false);
    expect(ordersService.updateStatus).not.toHaveBeenCalled();
  });
});
