import { Test, TestingModule } from '@nestjs/testing';
import { RefundsService } from '../refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CodMismatchService } from '../../cod-mismatch/cod-mismatch.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * D-B: refund via payment-list selection.
 *
 * - `sourcePaymentIds?: string[]` pins the refund to real PAID collections:
 *   same-order enforced, PAID-only (pending rows 400 with the approve-first
 *   message), per-row remainder cap (row.amount − Σ non-rejected refunds by
 *   sourcePaymentId), double-refund blocked via the cap.
 * - Every refund writes a timeline entry (not just cancelToo ones).
 * - The COD-alert recompute stays wired (locked here).
 */
describe('RefundsService — sourcePaymentIds bulk refund (D-B)', () => {
  let service: RefundsService;
  // Already-refunded totals keyed by source payment id (non-rejected rows).
  let perRowRefunded: Record<string, number>;
  const mockPrisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    refund: { findMany: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
    payment: {
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    order: { findUnique: jest.fn(), update: jest.fn() },
    orderStatus: { findFirst: jest.fn() },
    dispatch: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const mockCod: any = { recompute: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    perRowRefunded = {};
    mockPrisma.dispatch.findFirst.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CodMismatchService, useValue: mockCod },
        {
          provide: CancelReturnStockService,
          useValue: { releaseForCancellation: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(RefundsService);
  });

  function saleOrderPaid(orderId = 'order-1', paid = 2000) {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      total: paid,
      kind: 'SALE',
      timeline: [],
    });
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: paid } });
    mockPrisma.refund.aggregate.mockImplementation(async (args: any) => {
      const src = args?.where?.sourcePaymentId;
      if (typeof src === 'string')
        return { _sum: { amount: perRowRefunded[src] || 0 } };
      return { _sum: { amount: 0 } };
    });
    mockPrisma.refund.create.mockImplementation(async (args: any) => ({
      id: `r-${args.data.sourcePaymentId || 'auto'}`,
      status: 'pending',
      ...args.data,
    }));
  }

  function paidRow(id: string, orderId: string, amount: number, status = 'PAID') {
    return { id, orderId, status, amount };
  }

  it('creates a refund pinned to the given source payment with a timeline entry', async () => {
    saleOrderPaid();
    mockPrisma.payment.findMany.mockResolvedValue([
      paidRow('pay-1', 'order-1', 1000),
    ]);

    const result: any = await service.create({
      orderId: 'order-1',
      amount: 400,
      method: 'bkash',
      reason: 'damaged item',
      sourcePaymentIds: ['pay-1'],
    } as any);

    expect(result.sourcePaymentId).toBe('pay-1');
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: -400 }),
      }),
    );
    // Timeline entry per refund — not just for cancelToo.
    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          timeline: expect.arrayContaining([
            expect.objectContaining({
              type: 'refund',
              amount: 400,
              sourcePaymentId: 'pay-1',
            }),
          ]),
        }),
      }),
    );
    // Recompute stays wired.
    expect(mockCod.recompute).toHaveBeenCalledWith('order-1');
  });

  it('rejects source payments from another order', async () => {
    saleOrderPaid();
    mockPrisma.payment.findMany.mockResolvedValue([
      paidRow('pay-9', 'order-2', 1000),
    ]);

    await expect(
      service.create({
        orderId: 'order-1',
        amount: 400,
        method: 'bkash',
        reason: 'r',
        sourcePaymentIds: ['pay-9'],
      } as any),
    ).rejects.toThrow(/same order/i);
    expect(mockPrisma.refund.create).not.toHaveBeenCalled();
  });

  it('rejects PENDING source rows with the approve-first message', async () => {
    saleOrderPaid();
    mockPrisma.payment.findMany.mockResolvedValue([
      paidRow('pay-1', 'order-1', 1000, 'PENDING'),
    ]);

    await expect(
      service.create({
        orderId: 'order-1',
        amount: 400,
        method: 'bkash',
        reason: 'r',
        sourcePaymentIds: ['pay-1'],
      } as any),
    ).rejects.toThrow(/pending rows must be approved or failed first/i);
    expect(mockPrisma.refund.create).not.toHaveBeenCalled();
  });

  it('caps the refund at the per-row remainder', async () => {
    saleOrderPaid();
    perRowRefunded = { 'pay-1': 700 }; // 1000 collected, 700 already refunded
    mockPrisma.payment.findMany.mockResolvedValue([
      paidRow('pay-1', 'order-1', 1000),
    ]);

    await expect(
      service.create({
        orderId: 'order-1',
        amount: 500,
        method: 'bkash',
        reason: 'r',
        sourcePaymentIds: ['pay-1'],
      } as any),
    ).rejects.toThrow(/remaining refundable/i);
    expect(mockPrisma.refund.create).not.toHaveBeenCalled();
  });

  it('blocks a double refund of the same row via the cap', async () => {
    saleOrderPaid();
    perRowRefunded = { 'pay-1': 1000 }; // fully refunded already
    mockPrisma.payment.findMany.mockResolvedValue([
      paidRow('pay-1', 'order-1', 1000),
    ]);

    await expect(
      service.create({
        orderId: 'order-1',
        amount: 100,
        method: 'bkash',
        reason: 'again',
        sourcePaymentIds: ['pay-1'],
      } as any),
    ).rejects.toThrow(/remaining refundable/i);
    expect(mockPrisma.refund.create).not.toHaveBeenCalled();
  });

  it('splits a bulk refund across rows with one timeline entry per refund', async () => {
    saleOrderPaid('order-1', 1500);
    mockPrisma.payment.findMany.mockResolvedValue([
      paidRow('pay-1', 'order-1', 1000),
      paidRow('pay-2', 'order-1', 500),
    ]);

    const result: any = await service.create({
      orderId: 'order-1',
      amount: 1200,
      method: 'bkash',
      reason: 'bulk return',
      sourcePaymentIds: ['pay-1', 'pay-2'],
    } as any);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(mockPrisma.refund.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(2);
    const timeline = mockPrisma.order.update.mock.calls[0][0].data.timeline;
    expect(
      timeline.filter((e: any) => e.type === 'refund'),
    ).toHaveLength(2);
  });

  it('writes a timeline entry even for plain (non-cancelToo) refunds', async () => {
    saleOrderPaid();
    mockPrisma.refund.findMany.mockResolvedValue([]);
    mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1' });

    await service.create({
      orderId: 'order-1',
      amount: 200,
      method: 'cash',
      reason: 'goodwill',
    } as any);

    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          timeline: expect.arrayContaining([
            expect.objectContaining({ type: 'refund', amount: 200 }),
          ]),
        }),
      }),
    );
  });

  it('validates the legacy sourcePaymentId against its row remainder', async () => {
    saleOrderPaid();
    perRowRefunded = { 'pay-1': 900 };
    mockPrisma.payment.findMany.mockResolvedValue([
      paidRow('pay-1', 'order-1', 1000),
    ]);

    await expect(
      service.create({
        orderId: 'order-1',
        amount: 200,
        method: 'bkash',
        reason: 'r',
        sourcePaymentId: 'pay-1',
      } as any),
    ).rejects.toThrow(/remaining refundable/i);
    expect(mockPrisma.refund.create).not.toHaveBeenCalled();
  });
});
