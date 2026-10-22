import { Test, TestingModule } from '@nestjs/testing';
import { RefundsService } from '../refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * Staging regression: an atomic cancel-with-refund wrote the order to
 * 'Cancelled' but never released its managed/physical reservation. A plain
 * cancel already did. Both must funnel through the SAME release routine.
 */
describe('RefundsService — cancel-with-refund releases stock exactly like cancel', () => {
  let service: RefundsService;
  let prisma: any;
  let cancelReturnStock: { releaseForCancellation: jest.Mock };

  const dto = {
    orderId: 'order-1',
    amount: 2000,
    method: 'bkash',
    reason: 'Customer request',
    cancelToo: true,
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          total: 2000,
          kind: 'SALE',
          timeline: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'order-1' }),
      },
      orderStatus: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'status-cancelled', name: 'Cancelled' }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'refund-1',
          ...data,
        })),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 2000 } }),
        findFirst: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'pay-neg-1' }),
      },
      dispatch: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    cancelReturnStock = { releaseForCancellation: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
      ],
    }).compile();
    service = module.get<RefundsService>(RefundsService);
  });

  it('releases the reservation through the shared cancel routine, in the refund transaction', async () => {
    await service.create(dto as any, 'staff-1');

    expect(cancelReturnStock.releaseForCancellation).toHaveBeenCalledTimes(1);
    expect(cancelReturnStock.releaseForCancellation).toHaveBeenCalledWith({
      orderId: 'order-1',
      performedBy: 'staff-1',
      tx: prisma,
    });
  });

  it('a retry whose ledger is already exhausted cannot release a second time', async () => {
    await service.create(dto as any, 'staff-1');

    // The negative ledger row from the first refund cancels the PAID balance.
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    await expect(service.create(dto as any, 'staff-1')).rejects.toThrow(
      /no completed payment/i,
    );
    expect(cancelReturnStock.releaseForCancellation).toHaveBeenCalledTimes(1);
  });

  it('a targetStatusId of Cancelled (without cancelToo) also releases', async () => {
    prisma.orderStatus.findUnique.mockResolvedValue({
      id: 'status-cancelled',
      name: 'Cancelled',
    });

    await service.create(
      {
        ...dto,
        amount: 500,
        cancelToo: false,
        targetStatusId: 'status-cancelled',
      } as any,
      'staff-1',
    );

    expect(cancelReturnStock.releaseForCancellation).toHaveBeenCalledTimes(1);
    expect(cancelReturnStock.releaseForCancellation).toHaveBeenCalledWith({
      orderId: 'order-1',
      performedBy: 'staff-1',
      tx: prisma,
    });
  });

  it('a plain refund (no cancel) never releases the reservation', async () => {
    await service.create(
      { ...dto, amount: 500, cancelToo: false } as any,
      'staff-1',
    );

    expect(cancelReturnStock.releaseForCancellation).not.toHaveBeenCalled();
  });
});
