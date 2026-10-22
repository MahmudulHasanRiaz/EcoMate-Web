import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CodMismatchService } from '../../cod-mismatch/cod-mismatch.service';

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
      aggregate: jest.fn(),
    },
    paymentGateway: {
      findUnique: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
    },
    systemSetting: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Task 5 ledger defaults: unknown gateway codes resolve as manual,
    // settings absent → S1 ON / S2 OFF code defaults.
    mockPrisma.paymentGateway.findUnique.mockResolvedValue(null);
    mockPrisma.systemSetting.findMany.mockResolvedValue([]);
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
    const dto = { gatewayCode: 'manual', amount: 100, transactionId: 'tx-1', account: 'acc-1' };
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

  describe('cod mismatch recompute wiring (Task 4)', () => {
    const codOrder = {
      id: 'order-1',
      customerId: 'customer-1',
      viewToken: 'view-token-1',
      total: 1500,
      paymentOptionType: 'CASH_ON_DELIVERY',
      payments: [],
    };
    const codDto = { gatewayCode: 'bkash', amount: 1500, transactionId: 'TX1', account: 'acc-1' };

    function mockTxForCreate() {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(codOrder);
        mockPrisma.payment.create.mockResolvedValue({ id: 'pay-9', ...codDto, status: 'PENDING' });
        return fn(mockPrisma);
      });
    }

    async function makeWiredService(recompute: jest.Mock) {
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          PaymentsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: CodMismatchService, useValue: { recompute } },
        ],
      }).compile();
      return mod.get<PaymentsService>(PaymentsService);
    }

    it('payment-after-dispatch calls codMismatch.recompute(orderId)', async () => {
      const recompute = jest.fn().mockResolvedValue([]);
      const wired = await makeWiredService(recompute);
      mockTxForCreate();

      await wired.create('order-1', codDto as any, { userId: 'customer-1' });

      expect(recompute).toHaveBeenCalledWith('order-1');
    });

    it('verify calls codMismatch.recompute with the payment orderId', async () => {
      const recompute = jest.fn().mockResolvedValue([]);
      const wired = await makeWiredService(recompute);
      const stored = { id: 'pay-9', orderId: 'order-1', notes: null };
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.payment.findUnique.mockResolvedValue(stored);
        mockPrisma.payment.update.mockResolvedValue({ ...stored, orderId: 'order-1', status: 'PAID' });
        mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1500 } });
        mockPrisma.order.findUnique.mockResolvedValue({ total: 1500 });
        mockPrisma.order.update.mockResolvedValue({});
        return fn(mockPrisma);
      });

      await wired.verify('pay-9', { status: 'PAID' } as any, 'staff-1');

      expect(recompute).toHaveBeenCalledWith('order-1');
    });

    it('a failed alert never breaks the payment mutation (resilient)', async () => {
      const recompute = jest.fn().mockRejectedValue(new Error('alert boom'));
      const wired = await makeWiredService(recompute);
      mockTxForCreate();

      await expect(
        wired.create('order-1', codDto as any, { userId: 'customer-1' }),
      ).resolves.toBeDefined();
    });
  });

  describe('Part 3 — configured gateway + account identity on staff writes', () => {
    const orderId = 'order-1';
    const mockOrder = {
      id: orderId,
      customerId: 'customer-1',
      viewToken: 'view-token-1',
      total: 1000,
      paymentOptionType: 'FULL_PAYMENT',
      payments: [],
    };
    const staffOpts = { userId: 'staff-1', isStaff: true };

    function mockStaffTx() {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
        mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
        mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1', status: 'PENDING' });
        return fn(mockPrisma);
      });
    }

    it('rejects an unknown gateway code on a staff write (no silent manual fallback)', async () => {
      mockPrisma.paymentGateway.findUnique.mockResolvedValue(null);
      mockStaffTx();

      await expect(
        service.create(
          orderId,
          { gatewayCode: 'made_up', amount: 100, transactionId: 'tx' } as any,
          staffOpts,
        ),
      ).rejects.toThrow(/Unknown payment gateway/i);
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('stamps the gateway mapped settlement account when the client sends none', async () => {
      mockPrisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'gw-bkash',
        code: 'bkash',
        name: 'bKash',
        enabled: true,
        type: 'manual',
        accountId: 'acc-mapped',
      });
      mockStaffTx();

      await service.create(
        orderId,
        { gatewayCode: 'bkash', amount: 500, transactionId: 'TX1' } as any,
        staffOpts,
      );

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gatewayCode: 'bkash',
            accountId: 'acc-mapped',
          }),
        }),
      );
    });

    it('uses an explicitly supplied eligible account instead of the mapping', async () => {
      mockPrisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'gw-bkash',
        code: 'bkash',
        name: 'bKash',
        enabled: true,
        type: 'manual',
        accountId: 'acc-mapped',
      });
      mockPrisma.account.findUnique.mockResolvedValue({
        id: 'acc-custom',
        code: '1002',
        name: 'Bank',
        type: 'asset',
        isGroup: false,
        isActive: true,
      });
      mockStaffTx();

      await service.create(
        orderId,
        {
          gatewayCode: 'bkash',
          amount: 500,
          transactionId: 'TX1',
          accountId: 'acc-custom',
        } as any,
        staffOpts,
      );

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountId: 'acc-custom' }),
        }),
      );
    });

    it('rejects a supplied account that is not an eligible asset leaf', async () => {
      mockPrisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'gw-bkash',
        code: 'bkash',
        name: 'bKash',
        enabled: true,
        type: 'manual',
        accountId: 'acc-mapped',
      });
      mockPrisma.account.findUnique.mockResolvedValue({
        id: 'acc-expense',
        code: '5001',
        name: 'Expense',
        type: 'expense',
        isGroup: false,
        isActive: true,
      });
      mockStaffTx();

      await expect(
        service.create(
          orderId,
          {
            gatewayCode: 'bkash',
            amount: 500,
            transactionId: 'TX1',
            accountId: 'acc-expense',
          } as any,
          staffOpts,
        ),
      ).rejects.toThrow(/not an active, non-group Asset account/i);
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });
});
