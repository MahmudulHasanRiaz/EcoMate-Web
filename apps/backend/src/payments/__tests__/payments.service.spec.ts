import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: PrismaService;

  const mockPrisma = {
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    order: {
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create (payment proof)', () => {
    const orderId = 'order-1';
    const dto = { gatewayCode: 'manual', amount: 100, transactionId: 'tx-1' };
    const mockOrder = {
      id: orderId,
      customerId: 'customer-1',
      viewToken: 'view-token-1',
      total: 100,
      paymentOptionType: 'FULL_PAYMENT',
      payments: [],
    };

    it('rejects without ownership (no userId, no token)', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
        return fn(mockPrisma);
      });

      await expect(
        service.create(orderId, dto, { userId: undefined, token: undefined }),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts with matching userId (owns the order)', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
        mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1', ...dto, status: 'PENDING' });
        return fn(mockPrisma);
      });

      const result = await service.create(orderId, dto, { userId: 'customer-1' });
      expect(result).toBeDefined();
      expect(mockPrisma.payment.create).toHaveBeenCalled();
    });

    it('accepts with valid viewToken', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
        mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1', ...dto, status: 'PENDING' });
        return fn(mockPrisma);
      });

      const result = await service.create(orderId, dto, { token: 'view-token-1' });
      expect(result).toBeDefined();
    });

    it('rejects with wrong viewToken', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
        return fn(mockPrisma);
      });

      await expect(
        service.create(orderId, dto, { token: 'wrong-token' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with foreign customerId (different userId than customerId)', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
        return fn(mockPrisma);
      });

      await expect(
        service.create(orderId, dto, { userId: 'some-other-user' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts with different user if matching viewToken also provided', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
        mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1', ...dto, status: 'PENDING' });
        return fn(mockPrisma);
      });

      const result = await service.create(orderId, dto, { userId: 'some-other-user', token: 'view-token-1' });
      expect(result).toBeDefined();
    });
  });
});
