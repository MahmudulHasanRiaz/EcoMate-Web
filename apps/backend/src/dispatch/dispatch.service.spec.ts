import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { OrderStockDeductService } from '../stock/order-stock-deduct.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';

describe('DispatchService', () => {
  let service: DispatchService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'd-1',
          courier: 'pathao',
          consignmentId: 'CG-001',
        }),
        update: jest.fn().mockResolvedValue({ id: 'd-1' }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CancelReturnStockService,
          useValue: {
            holdReservationForReturnPending: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockService,
          useValue: {
            operate: jest.fn().mockResolvedValue([]),
            deduct: jest.fn().mockResolvedValue(undefined),
            fulfillPhysicalReservation: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
            resolve: jest.fn().mockReturnValue({ ms: 'skip', pi: 'skip' }),
          },
        },
        {
          provide: OrderStockDeductService,
          useValue: {
            deductForOrder: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<DispatchService>(DispatchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return dispatches list', async () => {
    const result = await service.findAll({});
    expect(result).toEqual({ data: [], total: 0 });
    expect(prisma.dispatch.findMany).toHaveBeenCalled();
  });

  it('should throw on not found', async () => {
    await expect(service.findOne('nonexistent')).rejects.toThrow();
  });

  it('maps dispatch RETURNED to order "Return Pending" (never a raw Returned)', async () => {
    // Dispatch claim: currently RETURN_PENDING, claimed to RETURNED.
    prisma.dispatch.findUnique.mockResolvedValueOnce({
      id: 'd-1',
      status: 'RETURN_PENDING',
    });
    prisma.dispatch.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    // findOne result used inside the transaction (claim winner).
    prisma.dispatch.findUnique.mockResolvedValueOnce({
      id: 'd-1',
      orderId: 'order-1',
      status: 'RETURNED',
      courier: 'pathao',
      consignmentId: 'CG-001',
      productMapping: null,
    });
    prisma.order = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { name: 'Delivered' },
        timeline: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.orderStatus = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'status-return-pending',
        name: 'Return Pending',
      }),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    await service.updateStatus('d-1', 'RETURNED', 'staff-123');

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          statusId: 'status-return-pending',
          timeline: expect.arrayContaining([
            expect.objectContaining({ status: 'Return Pending' }),
          ]),
        }),
      }),
    );
  });

  it('never writes a Returned order status via then dispatch sync path', async () => {
    prisma.dispatch.findUnique
      .mockResolvedValueOnce({ id: 'd-1', status: 'RETURN_PENDING' })
      .mockResolvedValueOnce({
        id: 'd-1',
        orderId: 'order-1',
        status: 'RETURNED',
        courier: 'pathao',
        consignmentId: 'CG-001',
        productMapping: null,
      });
    prisma.dispatch.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.order = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        status: { name: 'Return Pending' },
        timeline: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.orderStatus = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'status-returned',
        name: 'Returned',
      }),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    await service.updateStatus('d-1', 'RETURNED', 'staff-123');

    // syncOrderStatus guards: order already Return Pending → idx<target idx →
    // no write at all; and even if it wrote, it must not be Returned.
    const writes = (prisma.order.update as jest.Mock).mock.calls;
    for (const call of writes) {
      expect(call[0].data.statusId).not.toBe('status-returned');
    }
  });
});
