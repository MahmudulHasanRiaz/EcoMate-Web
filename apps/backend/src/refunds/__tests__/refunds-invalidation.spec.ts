/**
 * P2 §6 — analytics freshness: refund mutations drop `analytics:*`.
 *
 * Refunds feed the reversal line, the informational total and settlement;
 * the @Optional cache keeps unit tests provider-free (no-op path).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { RefundsService } from '../refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

describe('RefundsService analytics invalidation', () => {
  let service: RefundsService;
  const txMocks: any = {
    refund: { update: jest.fn(), aggregate: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
  };
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(txMocks)),
    refund: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    orderStatus: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    dispatch: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const mockCache: any = {
    invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get(RefundsService);
  });

  it('drops analytics:* after create', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      total: 1000,
    });
    mockPrisma.refund.create.mockImplementation(async (args: any) => ({
      id: 'r1',
      status: 'pending',
      ...args.data,
    }));

    await service.create({ orderId: 'o1', amount: 100 } as any);

    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });

  it('drops analytics:* after updateStatus to completed', async () => {
    mockPrisma.refund.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      status: 'approved',
      notes: null,
    });
    txMocks.refund.update.mockImplementation(async (args: any) => ({
      id: 'r1',
      order: { id: 'o1', displayId: 'ORD-1' },
      ...args.data,
    }));
    txMocks.order.findUnique.mockResolvedValue({ total: 1000 });
    txMocks.refund.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
    txMocks.order.update.mockResolvedValue({});

    await service.updateStatus(
      'r1',
      { status: 'completed' } as any,
      'staff-1',
    );

    expect(mockCache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
  });
});
