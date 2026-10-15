import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Task 5 — append-only ledger, S1 auto-verify, S2 edit gate reads,
 * D4 server-set recordedAt, manual account/txn validation (RED first).
 *
 * All Prisma access is mocked; the tx object IS the prisma mock
 * (mirrors orders.service.spec $transaction convention).
 */
describe('PaymentsService append-only ledger (Task 5)', () => {
  let service: PaymentsService;

  const mockPrisma = {
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    order: {
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
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
    systemSetting: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const baseOrder = {
    id: 'order-1',
    customerId: 'customer-1',
    guestPhone: null,
    viewToken: 'view-token-1',
    total: 1000,
    paymentOptionType: 'FULL_PAYMENT',
    partialAmount: null,
    payments: [] as any[],
  };

  function mockTx(opts?: {
    order?: any;
    gateway?: any;
    settings?: Array<{ key: string; value: string }>;
  }) {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue(
        opts?.order ?? baseOrder,
      );
      mockPrisma.paymentGateway.findUnique.mockResolvedValue(
        opts?.gateway ?? null,
      );
      mockPrisma.systemSetting.findMany.mockResolvedValue(
        opts?.settings ?? [],
      );
      mockPrisma.payment.create.mockImplementation(async (args: any) => ({
        id: 'pay-new',
        ...args.data,
      }));
      return fn(mockPrisma);
    });
  }

  const manualGateway = { code: 'bkash', type: 'manual' };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
  });

  it('second payment INSERTs, first row untouched (no UPDATE/DELETE)', async () => {
    const first = { id: 'pay-1', amount: 400, status: 'PAID' };
    mockTx({ order: { ...baseOrder, payments: [first] }, gateway: manualGateway });
    const dto = {
      gatewayCode: 'bkash',
      amount: 600,
      account: 'acc-1',
      transactionId: 'TX1',
    };

    const created = await service.create('order-1', dto as any, {
      userId: 'customer-1',
    });

    expect(Number((created as any).amount)).toBe(600);
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  });

  it('overpayment allowed (no exceeds-balance throw)', async () => {
    mockTx({ gateway: manualGateway });
    const dto = {
      gatewayCode: 'bkash',
      amount: 1500,
      account: 'acc-1',
      transactionId: 'TX-OVER',
    };

    const created = await service.create('order-1', dto as any, {
      userId: 'customer-1',
    });

    expect(Number((created as any).amount)).toBe(1500);
  });

  it('manual entry without account rejected (never silent manual)', async () => {
    mockTx({ gateway: manualGateway });

    await expect(
      service.create(
        'order-1',
        { gatewayCode: 'bkash', amount: 100, transactionId: 'TX1' } as any,
        { userId: 'customer-1' },
      ),
    ).rejects.toThrow(/account/i);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('unknown gateway code treated as manual (safe): account still required', async () => {
    mockTx({ gateway: null });

    await expect(
      service.create(
        'order-1',
        { gatewayCode: 'mystery', amount: 100, transactionId: 'TX1' } as any,
        { userId: 'customer-1' },
      ),
    ).rejects.toThrow(/account/i);
  });

  it('negative correction requires reason (notes)', async () => {
    mockTx({ gateway: manualGateway });

    await expect(
      service.create(
        'order-1',
        { gatewayCode: 'bkash', amount: -100, account: 'acc-1' } as any,
        { userId: 'customer-1' },
      ),
    ).rejects.toThrow(/reason/i);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('negative correction WITH reason is allowed', async () => {
    mockTx({
      order: {
        ...baseOrder,
        payments: [{ id: 'pay-1', amount: 1000, status: 'PAID' }],
      },
      gateway: manualGateway,
    });

    const created = await service.create(
      'order-1',
      {
        gatewayCode: 'bkash',
        amount: -200,
        account: 'acc-1',
        transactionId: 'TX-REIMBURSE',
        notes: 'partial refund for damaged item',
      } as any,
      { userId: 'customer-1' },
    );

    expect(Number((created as any).amount)).toBe(-200);
  });

  it('zero amount still rejected', async () => {
    mockTx({ gateway: manualGateway });

    await expect(
      service.create(
        'order-1',
        { gatewayCode: 'bkash', amount: 0, account: 'acc-1' } as any,
        { userId: 'customer-1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('recordedAt is server-set (ignores client date)', async () => {
    mockTx({ gateway: manualGateway });

    const created: any = await service.create(
      'order-1',
      {
        gatewayCode: 'bkash',
        amount: 100,
        account: 'acc-1',
        transactionId: 'TX1',
        recordedAt: '2001-01-01',
      } as any,
      { userId: 'customer-1' },
    );

    expect(created.recordedAt).toBeInstanceOf(Date);
    expect(new Date(created.recordedAt).getFullYear()).not.toBe(2001);
  });

  it('staff + S1 ON (default): manual entry PAID directly with verifiedBy/At', async () => {
    mockTx({ gateway: manualGateway });

    const created: any = await service.create(
      'order-1',
      { gatewayCode: 'bkash', amount: 100, account: 'acc-1' } as any,
      { userId: 'staff-1', isStaff: true },
    );

    expect(created.status).toBe('PAID');
    expect(created.verifiedBy).toBe('staff-1');
    expect(created.verifiedAt).toBeInstanceOf(Date);
    expect(created.recordedBy).toBe('staff:staff-1');
    expect(created.submittedBy).toBe('staff:staff-1');
  });

  it('staff + S1 OFF: manual entry PENDING and txnId required', async () => {
    mockTx({
      gateway: manualGateway,
      settings: [{ key: 'payments.staffAutoVerified', value: 'false' }],
    });

    await expect(
      service.create(
        'order-1',
        { gatewayCode: 'bkash', amount: 100, account: 'acc-1' } as any,
        { userId: 'staff-1', isStaff: true },
      ),
    ).rejects.toThrow(/transaction/i);

    const created: any = await service.create(
      'order-1',
      {
        gatewayCode: 'bkash',
        amount: 100,
        account: 'acc-1',
        transactionId: 'TX-S1OFF',
      } as any,
      { userId: 'staff-1', isStaff: true },
    );
    expect(created.status).toBe('PENDING');
  });

  it('customer manual entry always PENDING (even with S1 default ON)', async () => {
    mockTx({ gateway: manualGateway });

    const created: any = await service.create(
      'order-1',
      {
        gatewayCode: 'bkash',
        amount: 100,
        account: 'acc-1',
        transactionId: 'TX-CUST',
      } as any,
      { userId: 'customer-1' },
    );

    expect(created.status).toBe('PENDING');
    expect(created.recordedBy).toBeNull();
    expect(created.submittedBy).toBe('customer:customer-1');
  });

  it('api gateway entry is PAID without account/txn', async () => {
    mockTx({ gateway: { code: 'bkash_pgw', type: 'api' } });

    const created: any = await service.create(
      'order-1',
      { gatewayCode: 'bkash_pgw', amount: 1000 } as any,
      { userId: 'customer-1' },
    );

    expect(created.status).toBe('PAID');
  });

  it('staff may record on another customer\u2019s order (ownership gate exemption)', async () => {
    mockTx({ gateway: manualGateway });

    const created: any = await service.create(
      'order-1',
      { gatewayCode: 'bkash', amount: 100, account: 'acc-1' } as any,
      { userId: 'staff-9', isStaff: true },
    );

    expect(created).toBeDefined();
    expect(created.status).toBe('PAID');
  });

  it('getPaymentSettings defaults: staffAutoVerified=true, editAllowed=false', async () => {
    mockPrisma.systemSetting.findMany.mockResolvedValue([]);

    await expect(service.getPaymentSettings()).resolves.toEqual({
      staffAutoVerified: true,
      editAllowed: false,
    });
  });

  it('getPaymentSettings honors stored values', async () => {
    mockPrisma.systemSetting.findMany.mockResolvedValue([
      { key: 'payments.staffAutoVerified', value: 'false' },
      { key: 'payments.editAllowed', value: 'true' },
    ]);

    await expect(service.getPaymentSettings()).resolves.toEqual({
      staffAutoVerified: false,
      editAllowed: true,
    });
  });
});
