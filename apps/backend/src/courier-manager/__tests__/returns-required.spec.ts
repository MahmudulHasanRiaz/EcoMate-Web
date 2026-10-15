import { Test, TestingModule } from '@nestjs/testing';
import { CourierWebhookService } from '../courier-webhook.service';
import { CourierManagerService } from '../courier-manager.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * HIGH legacy restore: absent ReturnsService must throw LOUD, never raw restore.
 * RED phase: currently the legacy branch blanket-restores FULL via
 * cancelReturnStock.restoreForOrder — this test fails until the branch is deleted.
 */
describe('CourierWebhookService — ReturnsService required (HIGH legacy restore)', () => {
  let service: CourierWebhookService;
  let prisma: any;
  let cancelReturnStock: any;
  let manager: any;

  const order = {
    id: 'order-1',
    status: { id: 'st-shipping', name: 'Shipping' },
    timeline: [],
    displayId: 'ORD-1',
    courierService: 'steadfast',
  };

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(order),
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({}),
      },
      orderStatus: {
        findUnique: jest.fn().mockResolvedValue({ id: 'st-rp', name: 'Return Pending' }),
      },
      dispatch: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((cb: any) => cb({})),
    };
    manager = {
      getSteadfastReturnStatus: jest.fn().mockResolvedValue({
        deliveryStatus: 'cancelled_return_received',
      }),
    };
    cancelReturnStock = {
      restoreForOrder: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: { updateStatus: jest.fn().mockResolvedValue({}) } },
        { provide: CourierManagerService, useValue: manager },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
        // NOTE: no ReturnsService provider — @Optional() yields undefined.
      ],
    }).compile();

    service = module.get<CourierWebhookService>(CourierWebhookService);
  });

  it('absent ReturnsService → loud throw, no stock write', async () => {
    await expect(
      service.reconcileSteadfastReturn({ consignmentId: 'CG-1' }),
    ).rejects.toThrow(/ReturnsService.*required/i);
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });
});
