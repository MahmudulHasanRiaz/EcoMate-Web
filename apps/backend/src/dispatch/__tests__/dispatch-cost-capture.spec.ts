/**
 * P2 cost-capture tests — dispatch manual fulfillment-cost write (§3.4).
 *
 * A staff-provided cost at dispatch fills a missing Order.shippingCost as
 * 'manual' and overrides a 'courier_default' estimate; an existing 'manual'
 * cost always wins and is never overwritten. Courier auto-fill from a
 * per-courier default is deferred (no rate source exists) — documented in
 * the service.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from '../dispatch.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStockDeductService } from '../../stock/order-stock-deduct.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { CourierTrackingService } from '../../courier-manager/courier-tracking.service';
import { OrdersService } from '../../orders/orders.service';
import { CacheService } from '../../cache/cache.service';

describe('DispatchService dispatch shippingCost capture', () => {
  let service: DispatchService;
  const mockPrisma: any = {
    dispatch: { findUnique: jest.fn(), create: jest.fn() },
    order: { updateMany: jest.fn(), findUnique: jest.fn() },
    courierDispatchLog: { create: jest.fn() },
  };
  const mockCache: any = {
    invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrderStockDeductService, useValue: {} },
        { provide: CancelReturnStockService, useValue: {} },
        { provide: CourierTrackingService, useValue: {} },
        { provide: OrdersService, useValue: {} },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get(DispatchService);
    mockPrisma.dispatch.findUnique.mockResolvedValue(null);
    mockPrisma.dispatch.create.mockImplementation(async (args: any) => ({
      id: 'd1',
      ...args.data,
    }));
    mockPrisma.courierDispatchLog.create.mockResolvedValue({});
    mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
  });

  const dto = (extra: Record<string, unknown> = {}) => ({
    orderId: 'o1',
    courier: 'PATHAO',
    consignmentId: 'C-1',
    ...extra,
  });

  it('fills a missing shippingCost as manual', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      shippingCost: null,
      shippingCostSource: null,
    });
    await service.create(dto({ shippingCost: 60 }) as any);
    expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', shippingCost: null },
      data: { shippingCost: 60, shippingCostSource: 'manual' },
    });
  });

  it('never overwrites an existing manual cost (manual wins)', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      shippingCost: 55,
      shippingCostSource: 'manual',
    });
    await service.create(dto({ shippingCost: 60 }) as any);
    const costWrites = mockPrisma.order.updateMany.mock.calls.filter(
      ([args]: any[]) => 'shippingCost' in (args.data ?? {}),
    );
    expect(costWrites).toHaveLength(0);
  });

  it('overrides a courier_default estimate with a manual cost', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      shippingCost: 70,
      shippingCostSource: 'courier_default',
    });
    await service.create(dto({ shippingCost: 60 }) as any);
    expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { shippingCost: 60, shippingCostSource: 'manual' },
    });
  });

  it('leaves the cost alone when none is provided', async () => {
    await service.create(dto() as any);
    const costWrites = mockPrisma.order.updateMany.mock.calls.filter(
      ([args]: any[]) => 'shippingCost' in (args.data ?? {}),
    );
    expect(costWrites).toHaveLength(0);
  });

  it('drops analytics:* after create (P2 §6)', async () => {
    await service.create(dto() as any);
    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });
});
