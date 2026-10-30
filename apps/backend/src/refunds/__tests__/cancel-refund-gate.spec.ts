import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RefundsService } from '../refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';

/**
 * Task 9 (D5): cancel/refund gate + atomic cancel-too.
 *
 * Gate rule (single source of truth): outstanding = netPaid − legacyRefunded,
 * where netPaid = Σ signed PAID payment rows (Task 5 negative corrections
 * included) and legacyRefunded = Σ approved/completed Refund rows with
 * method NULL (recorded before ledger mirroring; every new-flow refund
 * carries method + a matching negative payment row, so counting new rows
 * here would double-count).
 */
describe('RefundsService — Task 9 cancel/refund gate (RED)', () => {
  let service: RefundsService;
  let prisma: PrismaService;

  const mockPrisma: any = {
    $transaction: jest.fn(),
    refund: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
    },
    payment: {
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    orderStatus: {
      findFirst: jest.fn(),
    },
    dispatch: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $executeRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) =>
      cb(mockPrisma),
    );
    mockPrisma.dispatch.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: CancelReturnStockService,
          useValue: { releaseForCancellation: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  function saleOrder(statusName = 'Pending') {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-id-1',
      total: 2000,
      kind: 'SALE',
      status: { name: statusName },
    });
  }

  function paidAggregate(net: number) {
    (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: net },
    });
    (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: 0 },
    });
  }

  function sourcePayment() {
    (prisma.refund.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: 'pay-1' });
  }

  describe('refund requires account/method + reason', () => {
    it('400s without method (where the money went back)', async () => {
      saleOrder();
      paidAggregate(2000);
      await expect(
        service.create({ orderId: 'order-id-1', amount: 500, reason: 'r' } as any),
      ).rejects.toThrow(/method/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('400s without reason', async () => {
      saleOrder();
      paidAggregate(2000);
      await expect(
        service.create({ orderId: 'order-id-1', amount: 500, method: 'bkash' } as any),
      ).rejects.toThrow(/reason/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });
  });

  describe('refund writes negative ledger row in the same tx', () => {
    it('creates Refund row + negative PAID payment row atomically', async () => {
      saleOrder();
      paidAggregate(2000);
      sourcePayment();
      (prisma.refund.create as jest.Mock).mockResolvedValue({ id: 'ref-1' });
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-neg' });

      await service.create(
        { orderId: 'order-id-1', amount: 500, method: 'bkash', reason: 'Defective item' } as any,
        'staff-1',
      );

      expect(prisma.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ method: 'bkash', amount: 500 }),
        }),
      );
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-id-1',
            amount: -500,
            status: 'PAID',
            gatewayCode: 'bkash',
          }),
        }),
      );
      // Single transaction: both writes went through the tx client.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelToo', () => {
    it('cancelToo=true refunds AND cancels atomically (status + timeline)', async () => {
      saleOrder('Confirmed');
      paidAggregate(2000);
      sourcePayment();
      (prisma.refund.create as jest.Mock).mockResolvedValue({ id: 'ref-1' });
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-neg' });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({ id: 'order-id-1' });

      await service.create(
        {
          orderId: 'order-id-1',
          amount: 2000,
          method: 'bkash',
          reason: 'Full refund, customer cancelled',
          cancelToo: true,
        } as any,
        'staff-1',
      );

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-id-1' },
          data: expect.objectContaining({ statusId: 'status-cancelled' }),
        }),
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('cancelToo=false refunds only (no status change)', async () => {
      saleOrder('Confirmed');
      paidAggregate(2000);
      sourcePayment();
      (prisma.refund.create as jest.Mock).mockResolvedValue({ id: 'ref-1' });
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-neg' });

      await service.create(
        {
          orderId: 'order-id-1',
          amount: 500,
          method: 'bkash',
          reason: 'Partial refund',
          cancelToo: false,
        } as any,
        'staff-1',
      );

      expect(prisma.refund.create).toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalled();
      // D-B: no status change — but the refund still leaves a timeline entry.
      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'order-id-1' });
      expect(updateCall.data).not.toHaveProperty('statusId');
      expect(updateCall.data.timeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'refund', amount: 500 }),
        ]),
      );
    });

    it('cancelToo with partial amount (outstanding remains) is rejected', async () => {
      saleOrder('Confirmed');
      paidAggregate(2000);
      sourcePayment();

      await expect(
        service.create(
          {
            orderId: 'order-id-1',
            amount: 500,
            method: 'bkash',
            reason: 'Partial + cancel attempt',
            cancelToo: true,
          } as any,
          'staff-1',
        ),
      ).rejects.toThrow(/outstanding|full/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('legacy refunds (pre-ledger, method NULL) unblock the gate', () => {
    it('legacy completed refund reduces outstanding (no double-count)', async () => {
      saleOrder();
      // Gross paid 2000, no negative rows yet; legacy completed refund 2000.
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 2000 },
      });
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 2000 },
      });
      sourcePayment();
      (prisma.refund.create as jest.Mock).mockResolvedValue({ id: 'ref-2' });
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-neg' });

      // A further refund of 100 must be capped: outstanding is 0.
      await expect(
        service.create(
          { orderId: 'order-id-1', amount: 100, method: 'bkash', reason: 'extra' } as any,
          'staff-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
