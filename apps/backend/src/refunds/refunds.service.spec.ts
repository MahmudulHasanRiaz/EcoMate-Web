import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';


describe('RefundsService', () => {
  let service: RefundsService;
  let prisma: PrismaService;

  const mockRefund = {
    id: 'refund-id-1',
    orderId: 'order-id-1',
    amount: 1500,
    reason: 'Customer request',
    notes: 'Refund for damaged item',
    status: 'pending',
    processedBy: null,
    processedAt: null,
    createdAt: new Date('2025-01-15'),
    updatedAt: new Date('2025-01-15'),
    order: { displayId: 'ORD-250115-0001' },
    processor: null,
  };

  const mockRefundApproved = {
    ...mockRefund,
    id: 'refund-id-2',
    status: 'approved',
    processedBy: 'admin-id-1',
    processedAt: new Date('2025-01-16'),
    processor: { id: 'admin-id-1', firstName: 'Admin', lastName: 'User' },
  };

  const mockRefundCompleted = {
    ...mockRefund,
    id: 'refund-id-3',
    status: 'completed',
    order: { id: 'order-id-1', displayId: 'ORD-250115-0001' },
  };

  const mockRefundRejected = {
    ...mockRefund,
    id: 'refund-id-4',
    status: 'rejected',
  };

  const mockPrisma = {
    $transaction: jest.fn(),
    refund: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    // Refunds are capped by what was actually PAID, so the service reads the
    // payment ledger rather than the order total.
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 2000 } }),
      findFirst: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      // Prisma returns the created row; the service reads its id to anchor the
      // Phase 2 journal mirror on it.
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: 'pay-refund-1', ...data })),
    },
    dispatch: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockPrisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: CancelReturnStockService,
          useValue: { releaseForCancellation: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete (prisma as any).paymentGateway;
    delete (prisma as any).account;
  });

  describe('findAll', () => {
    it('should return paginated refunds', async () => {
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([
        mockRefund,
        mockRefundApproved,
      ]);
      (prisma.refund.count as jest.Mock).mockResolvedValue(2);

      const result = await service.findAll({ page: 1, perPage: 10 });

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(prisma.refund.count).toHaveBeenCalled();
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        perPage: 10,
        totalPages: 1,
      });
    });

    it('should filter by status', async () => {
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([mockRefund]);
      (prisma.refund.count as jest.Mock).mockResolvedValue(1);

      await service.findAll({ status: 'pending' });

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'pending' } }),
      );
    });

    it('should filter by orderId', async () => {
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([mockRefund]);
      (prisma.refund.count as jest.Mock).mockResolvedValue(1);

      await service.findAll({ orderId: 'order-id-1' });

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderId: 'order-id-1' } }),
      );
    });

    it('should use default pagination values', async () => {
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.refund.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({});

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('should calculate totalPages correctly', async () => {
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([mockRefund]);
      (prisma.refund.count as jest.Mock).mockResolvedValue(25);

      const result = await service.findAll({ page: 1, perPage: 10 });

      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('findOne', () => {
    it('should return a refund by id', async () => {
      (prisma.refund.findUnique as jest.Mock).mockResolvedValue(
        mockRefundApproved,
      );

      const result = await service.findOne('refund-id-2');

      expect(prisma.refund.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'refund-id-2' } }),
      );
      expect(result).toEqual(mockRefundApproved);
      expect(result.order.displayId).toBe('ORD-250115-0001');
    });

    it('should throw NotFoundException if refund not found', async () => {
      (prisma.refund.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto = {
      orderId: 'order-id-1',
      amount: 1500,
      method: 'bkash',
      reason: 'Customer request',
      notes: 'Refund for damaged item',
    };

    it('should create a refund successfully', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 2000,
        kind: 'SALE',
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 2000 },
      });
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 0 },
      });
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: 'pay-1' });
      (prisma.refund.create as jest.Mock).mockResolvedValue(mockRefund);

      const result = await service.create(createDto);

      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: createDto.orderId },
        select: { id: true, total: true, kind: true, timeline: true },
      });
      // Traceability: the refund is pinned to the exact payment it reverses.
      expect(prisma.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: createDto.orderId,
            amount: createDto.amount,
            reason: createDto.reason,
            notes: createDto.notes,
            sourcePaymentId: 'pay-1',
          }),
        }),
      );
      expect(result.status).toBe('pending');
    });

    it('caps the refund by the amount actually PAID, not the order total', async () => {
      // Order worth 2000 but only 500 collected (COD). A refund of 1000 would
      // reverse revenue that was never recognised.
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 2000,
        kind: 'SALE',
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 500 },
      });
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });

      await expect(
        service.create({
          orderId: 'order-id-1',
          amount: 1000,
          method: 'bkash',
          reason: 'Customer request',
        }),
      ).rejects.toThrow(/exceeds the amount actually paid/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('refuses a refund when nothing was ever paid', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 2000,
        kind: 'SALE',
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });

      await expect(
        service.create({
          orderId: 'order-id-1',
          amount: 100,
          method: 'bkash',
          reason: 'Customer request',
        }),
      ).rejects.toThrow(/no completed payment/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('refuses a refund against a non-sale order (return/exchange)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'rtn-1',
        total: 500,
        kind: 'RETURN',
      });

      await expect(
        service.create({ orderId: 'rtn-1', amount: 100 }),
      ).rejects.toThrow(/only be issued against a sale order/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if order does not exist', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if amount exceeds order total', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 100,
      });

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('should create refund with minimal fields', async () => {
      const minimalDto = {
        orderId: 'order-id-1',
        amount: 500,
        method: 'bkash',
        reason: 'Customer request',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 1000,
        kind: 'SALE',
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 1000 },
      });
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 0 },
      });
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: 'pay-1' });
      (prisma.refund.create as jest.Mock).mockResolvedValue({
        ...mockRefund,
        reason: undefined,
        notes: undefined,
      });

      await service.create(minimalDto);

      const createCall = (prisma.refund.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.amount).toBe(500);
    });

    it('mirrors the selected configured gateway + mapped account onto the negative ledger row', async () => {
      (prisma as any).paymentGateway = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'gw-bkash',
          code: 'bkash',
          name: 'bKash',
          enabled: true,
          type: 'manual',
          accountId: 'acc-bkash',
        }),
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 2000,
        kind: 'SALE',
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 2000 } });
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: 'pay-1' });
      (prisma.refund.create as jest.Mock).mockResolvedValue(mockRefund);

      await service.create({
        ...createDto,
        method: 'bKash',
        gatewayCode: 'bkash',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gatewayCode: 'bkash',
            accountId: 'acc-bkash',
            account: 'bKash',
            amount: -1500,
          }),
        }),
      );
    });

    it('prefers an explicitly supplied eligible account over the gateway mapping', async () => {
      (prisma as any).paymentGateway = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'gw-bkash',
          code: 'bkash',
          name: 'bKash',
          enabled: true,
          type: 'manual',
          accountId: 'acc-bkash',
        }),
      };
      (prisma as any).account = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'acc-custom',
          code: '1002',
          name: 'Bank',
          type: 'asset',
          isGroup: false,
          isActive: true,
        }),
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 2000,
        kind: 'SALE',
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 2000 } });
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });
      (prisma.refund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: 'pay-1' });
      (prisma.refund.create as jest.Mock).mockResolvedValue(mockRefund);

      await service.create({
        ...createDto,
        gatewayCode: 'bkash',
        accountId: 'acc-custom',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountId: 'acc-custom' }),
        }),
      );
    });

    it('rejects an unknown gateway code on the refund write path', async () => {
      (prisma as any).paymentGateway = {
        findUnique: jest.fn().mockResolvedValue(null),
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 2000,
        kind: 'SALE',
      });

      await expect(
        service.create({ ...createDto, gatewayCode: 'made_up' }),
      ).rejects.toThrow(/Unknown payment gateway/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('rejects a refund account that is not an eligible asset leaf', async () => {
      (prisma as any).paymentGateway = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'gw-bkash',
          code: 'bkash',
          name: 'bKash',
          enabled: true,
          type: 'manual',
          accountId: 'acc-bkash',
        }),
      };
      (prisma as any).account = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'acc-expense',
          code: '5001',
          name: 'Expense',
          type: 'expense',
          isGroup: false,
          isActive: true,
        }),
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-id-1',
        total: 2000,
        kind: 'SALE',
      });

      await expect(
        service.create({ ...createDto, gatewayCode: 'bkash', accountId: 'acc-expense' }),
      ).rejects.toThrow(/not an active, non-group Asset account/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    const processedBy = 'admin-id-1';

    describe('valid transitions', () => {
      it('should transition from pending to approved', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund);
        (prisma.refund.update as jest.Mock).mockResolvedValue(
          mockRefundApproved,
        );

        const result = await service.updateStatus(
          'refund-id-1',
          { status: 'approved' },
          processedBy,
        );

        expect(prisma.refund.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'refund-id-1' },
            data: expect.objectContaining({ status: 'approved', processedBy }),
          }),
        );
        expect(result.status).toBe('approved');
      });

      it('should transition from pending to rejected', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund);
        (prisma.refund.update as jest.Mock).mockResolvedValue(
          mockRefundRejected,
        );

        const result = await service.updateStatus(
          'refund-id-1',
          { status: 'rejected' },
          processedBy,
        );

        expect(result.status).toBe('rejected');
      });

      it('should transition from approved to completed', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(
          mockRefundApproved,
        );
        (prisma.refund.update as jest.Mock).mockResolvedValue(
          mockRefundCompleted,
        );
        (prisma.order.findUnique as jest.Mock).mockResolvedValue({
          total: 1500,
        });
        (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
          _sum: { amount: 1500 },
        });

        const result = await service.updateStatus(
          'refund-id-2',
          { status: 'completed' },
          processedBy,
        );

        expect(result.status).toBe('completed');
        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'order-id-1' },
            data: expect.objectContaining({ paymentStatus: 'REFUNDED' }),
          }),
        );
      });

      it('should set PAYMENT status for partial refunds', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(
          mockRefundApproved,
        );
        (prisma.refund.update as jest.Mock).mockResolvedValue(
          mockRefundCompleted,
        );
        (prisma.order.findUnique as jest.Mock).mockResolvedValue({
          total: 2000,
        });
        (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
          _sum: { amount: 1500 },
        });

        const result = await service.updateStatus(
          'refund-id-2',
          { status: 'completed' },
          processedBy,
        );

        expect(result.status).toBe('completed');
        expect(prisma.order.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'order-id-1' },
            data: expect.objectContaining({
              paymentStatus: 'PARTIAL_REFUNDED',
            }),
          }),
        );
      });

      it('should transition from approved to rejected', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(
          mockRefundApproved,
        );
        (prisma.refund.update as jest.Mock).mockResolvedValue({
          ...mockRefundApproved,
          status: 'rejected',
        });

        const result = await service.updateStatus(
          'refund-id-2',
          { status: 'rejected' },
          processedBy,
        );

        expect(result.status).toBe('rejected');
      });
    });

    describe('invalid transitions', () => {
      it('should throw BadRequestException when transitioning from completed', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(
          mockRefundCompleted,
        );

        await expect(
          service.updateStatus(
            'refund-id-3',
            { status: 'approved' },
            processedBy,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException when transitioning from rejected', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(
          mockRefundRejected,
        );

        await expect(
          service.updateStatus(
            'refund-id-4',
            { status: 'approved' },
            processedBy,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException when transitioning from pending to completed (skip approved)', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund);

        await expect(
          service.updateStatus(
            'refund-id-1',
            { status: 'completed' },
            processedBy,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should include allowed transitions in error message', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund);

        try {
          await service.updateStatus(
            'refund-id-1',
            { status: 'completed' },
            processedBy,
          );
          fail('Expected BadRequestException was not thrown');
        } catch (error) {
          expect(error.message).toContain(
            'Cannot transition from "pending" to "completed"',
          );
          expect(error.message).toContain('approved');
          expect(error.message).toContain('rejected');
        }
      });
    });

    describe('edge cases', () => {
      it('should throw NotFoundException if refund not found', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(
          service.updateStatus(
            'nonexistent-id',
            { status: 'approved' },
            processedBy,
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('should set processedAt when updating status', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund);
        (prisma.refund.update as jest.Mock).mockResolvedValue(
          mockRefundApproved,
        );

        await service.updateStatus(
          'refund-id-1',
          { status: 'approved' },
          processedBy,
        );

        const updateCall = (prisma.refund.update as jest.Mock).mock.calls[0][0];
        expect(updateCall.data.processedAt).toBeDefined();
        expect(updateCall.data.processedAt).toBeInstanceOf(Date);
      });

      it('should preserve notes when provided in update', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund);
        (prisma.refund.update as jest.Mock).mockResolvedValue(
          mockRefundApproved,
        );

        await service.updateStatus(
          'refund-id-1',
          { status: 'approved', notes: 'Approved after verification' },
          processedBy,
        );

        const updateCall = (prisma.refund.update as jest.Mock).mock.calls[0][0];
        expect(updateCall.data.notes).toBe('Approved after verification');
      });

      it('should keep existing notes when no new notes provided', async () => {
        (prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund);
        (prisma.refund.update as jest.Mock).mockResolvedValue(
          mockRefundApproved,
        );

        await service.updateStatus(
          'refund-id-1',
          { status: 'approved' },
          processedBy,
        );

        const updateCall = (prisma.refund.update as jest.Mock).mock.calls[0][0];
        expect(updateCall.data.notes).toBe(mockRefund.notes);
      });
    });
  });
});
