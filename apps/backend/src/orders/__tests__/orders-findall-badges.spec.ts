import { BadRequestException } from '@nestjs/common';
import { OrdersService } from '../orders.service';

describe('OrdersService.findAll badges + exchangeScope filter', () => {
  let service: OrdersService;
  let prisma: any;

  const baseRow = {
    id: 'order-1',
    displayId: 'ORD-1',
    total: 1000,
    shippingAddress: null,
    timeline: [],
    dispatches: [],
    editLock: null,
  };

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    service = new OrdersService(prisma, ...Array(22).fill({}));
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    prisma.order.groupBy.mockResolvedValue([]);
  });

  it('maps _count to badge flags', async () => {
    prisma.order.findMany.mockResolvedValue([
      { ...baseRow, _count: { returns: 2, exchanges: 1 } },
      { ...baseRow, id: 'order-2', _count: { returns: 0, exchanges: 0 } },
    ]);
    const res: any = await service.findAll({ page: 1, perPage: 10 });
    expect(res.data[0]).toMatchObject({
      hasActiveReturn: true,
      activeReturnCount: 2,
      hasActiveExchange: true,
      activeExchangeCount: 1,
    });
    expect(res.data[1]).toMatchObject({
      hasActiveReturn: false,
      activeReturnCount: 0,
      hasActiveExchange: false,
      activeExchangeCount: 0,
    });
  });

  it('requests filtered relation counts in one query (no N+1)', async () => {
    await service.findAll({ page: 1, perPage: 10 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: {
            select: {
              returns: { where: { status: { not: 'CLOSED' } } },
              exchanges: { where: { trashedAt: null } },
            },
          },
        }),
      }),
    );
  });

  it('filters kind=EXCHANGE by type=FULL via exchangeScope', async () => {
    await service.findAll({ kind: 'EXCHANGE', type: 'FULL' } as any);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ exchangeScope: 'FULL' }),
      }),
    );
  });

  it('filters kind=EXCHANGE by type=PARTIAL', async () => {
    await service.findAll({ kind: 'EXCHANGE', type: 'PARTIAL' } as any);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ exchangeScope: 'PARTIAL' }),
      }),
    );
  });

  it('rejects unknown type values', async () => {
    await expect(
      service.findAll({ kind: 'EXCHANGE', type: 'BOGUS' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects type filter without kind=EXCHANGE', async () => {
    await expect(service.findAll({ type: 'FULL' } as any)).rejects.toThrow(
      BadRequestException,
    );
  });
});
