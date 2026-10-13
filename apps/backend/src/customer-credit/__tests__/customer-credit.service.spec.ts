import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { CustomerCreditService } from '../customer-credit.service';
import { CustomerCreditController } from '../customer-credit.controller';
import { PaymentsService } from '../../payments/payments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Task 8 — customer credit: marginal overpay grant, clamped apply-credit,
 * profile ledger, controller guards, payments.create wiring (TDD RED first).
 *
 * Money arithmetic under test:
 *   coverage(order) = SUM(PAID payment.amount) + SUM(appliedCreditAmount)
 * (cod-mismatch recompute). A customer_credit payment row carries the covered
 * amount in `amount` with `appliedCreditAmount = NULL` — setting both would
 * double-count the same taka in systemDue. Provenance lives in
 * gatewayCode/account ('customer_credit') + the linked negative entry.
 */
describe('CustomerCreditService.grantFromOverpayment (marginal excess)', () => {
  let service: CustomerCreditService;
  const mockPrisma: any = {
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    order: { findUnique: jest.fn() },
    payment: { create: jest.fn() },
    customerCreditEntry: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  function fakeTx() {
    return {
      customerCreditEntry: {
        create: jest.fn(async ({ data }: any) => ({ id: 'entry-1', ...data })),
      },
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerCreditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<CustomerCreditService>(CustomerCreditService);
  });

  it('grants only the NEW marginal excess (two overpays → two entries, sums correct)', async () => {
    const tx: any = fakeTx();
    // order total 1000, already paid 1300 (excessBefore 300), new PAID 200
    // → excessAfter 500 → marginal grant 200 (NOT 500).
    const row = await service.grantFromOverpayment(tx, {
      customerId: 'cust-1',
      orderId: 'order-1',
      paymentId: 'pay-2',
      orderTotal: 1000,
      paidBefore: 1300,
      newAmount: 200,
      isPaid: true,
    });
    expect(tx.customerCreditEntry.create).toHaveBeenCalledTimes(1);
    expect(tx.customerCreditEntry.create).toHaveBeenCalledWith({
      data: {
        customerId: 'cust-1',
        orderId: 'order-1',
        paymentId: 'pay-2',
        amount: 200,
        reason: 'overpayment:order-1',
      },
    });
    expect(Number((row as any).amount)).toBe(200);
  });

  it('grants full excess on the first overpay (paidBefore below total)', async () => {
    const tx: any = fakeTx();
    const row = await service.grantFromOverpayment(tx, {
      customerId: 'cust-1',
      orderId: 'order-1',
      paymentId: 'pay-1',
      orderTotal: 1000,
      paidBefore: 800,
      newAmount: 500,
      isPaid: true,
    });
    expect(Number((row as any).amount)).toBe(300);
  });

  it('no grant when exact or under (returns null, no INSERT)', async () => {
    for (const [paidBefore, newAmount] of [
      [800, 200], // lands exactly on total
      [500, 200], // still under
    ]) {
      const tx: any = fakeTx();
      const row = await service.grantFromOverpayment(tx, {
        customerId: 'cust-1',
        orderId: 'order-1',
        paymentId: 'pay-x',
        orderTotal: 1000,
        paidBefore,
        newAmount,
        isPaid: true,
      });
      expect(row).toBeNull();
      expect(tx.customerCreditEntry.create).not.toHaveBeenCalled();
    }
  });

  it('no grant when the new payment is PENDING (verification later, not now)', async () => {
    const tx: any = fakeTx();
    const row = await service.grantFromOverpayment(tx, {
      customerId: 'cust-1',
      orderId: 'order-1',
      paymentId: 'pay-p',
      orderTotal: 1000,
      paidBefore: 0,
      newAmount: 5000,
      isPaid: false,
    });
    expect(row).toBeNull();
    expect(tx.customerCreditEntry.create).not.toHaveBeenCalled();
  });
});

describe('CustomerCreditService.applyCredit (clamped, never negative)', () => {
  let service: CustomerCreditService;
  let ledger: Array<{ amount: number; reason: string }>;
  const mockPrisma: any = {
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    order: { findUnique: jest.fn() },
    payment: { create: jest.fn() },
    customerCreditEntry: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ledger = [
      { amount: 300, reason: 'overpayment:order-9' },
      { amount: -100, reason: 'applied:order-8' },
    ]; // balance = 200
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      customerId: 'cust-1',
      total: 1000,
    });
    mockPrisma.customerCreditEntry.aggregate.mockImplementation(async () => ({
      _sum: { amount: ledger.reduce((s, e) => s + e.amount, 0) },
    }));
    mockPrisma.payment.create.mockImplementation(async ({ data }: any) => ({
      id: 'pay-credit-1',
      ...data,
    }));
    mockPrisma.customerCreditEntry.create.mockImplementation(
      async ({ data }: any) => {
        ledger.push({ amount: Number(data.amount), reason: data.reason });
        return { id: 'entry-x', ...data };
      },
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerCreditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<CustomerCreditService>(CustomerCreditService);
  });

  it('apply clamps to balance (request 500, balance 200 → uses 200)', async () => {
    const res: any = await service.applyCredit('order-1', 500, 'staff-1');
    expect(res.applied).toBe(200);
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        gatewayCode: 'customer_credit',
        account: 'customer_credit',
        amount: 200,
        status: 'PAID',
        recordedBy: 'staff:staff-1',
      }),
    });
    // amount carries coverage; appliedCreditAmount stays NULL so the
    // cod-mismatch recompute (paid + applied) never double-counts.
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ appliedCreditAmount: null }),
    });
    expect(mockPrisma.customerCreditEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'cust-1',
        orderId: 'order-1',
        paymentId: 'pay-credit-1',
        amount: -200,
        reason: 'applied:order-1',
        createdBy: 'staff-1',
      }),
    });
    expect(res.balance).toBe(0);
  });

  it('apply with 0 balance → 400', async () => {
    ledger = [];
    await expect(service.applyCredit('order-1', 100, 'staff-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('apply with non-positive amount → 400', async () => {
    await expect(service.applyCredit('order-1', 0, 'staff-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.applyCredit('order-1', -50, 'staff-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('order without customer → 400 (guest credit cannot exist)', async () => {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-g',
      customerId: null,
      total: 500,
    });
    await expect(service.applyCredit('order-g', 50, 'staff-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('unknown order → 404', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    await expect(service.applyCredit('nope', 50, 'staff-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('sequential double-apply never drives balance negative', async () => {
    const first: any = await service.applyCredit('order-1', 150, 'staff-1');
    expect(first.applied).toBe(150);
    expect(first.balance).toBe(50);
    const second: any = await service.applyCredit('order-1', 100, 'staff-1');
    expect(second.applied).toBe(50);
    expect(second.balance).toBe(0);
    await expect(service.applyCredit('order-1', 10, 'staff-1')).rejects.toThrow(
      /No credit available/,
    );
    const total = ledger.reduce((s, e) => s + e.amount, 0);
    expect(total).toBe(0);
  });
});

describe('CustomerCreditService.getProfile', () => {
  it('returns balance + entries newest-first', async () => {
    const mockPrisma: any = {
      customerCreditEntry: {
        aggregate: jest.fn(async () => ({ _sum: { amount: 150 } })),
        findMany: jest.fn(async () => [
          { id: 'e2', amount: -50, createdAt: new Date('2026-02-02') },
          { id: 'e1', amount: 200, createdAt: new Date('2026-02-01') },
        ]),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerCreditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    const svc = module.get<CustomerCreditService>(CustomerCreditService);
    const res: any = await svc.getProfile('cust-1');
    expect(res.balance).toBe(150);
    expect(res.entries).toHaveLength(2);
    expect(mockPrisma.customerCreditEntry.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PaymentsService.create credit-grant wiring (Task 8)', () => {
  const mockPrisma: any = {
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    order: { findUniqueOrThrow: jest.fn() },
    payment: { create: jest.fn() },
    paymentGateway: { findUnique: jest.fn() },
    systemSetting: { findMany: jest.fn() },
  };
  const mockCredit = { grantFromOverpayment: jest.fn() };
  const mockCod = { recompute: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCredit.grantFromOverpayment.mockResolvedValue(null);
    mockCod.recompute.mockResolvedValue([]);
  });

  async function makeService() {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CustomerCreditService, useValue: mockCredit },
        { provide: require('../../cod-mismatch/cod-mismatch.service').CodMismatchService, useValue: mockCod },
      ],
    }).compile();
    return module.get<PaymentsService>(PaymentsService);
  }

  function mockPaidCreate(order: any) {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue(order);
      mockPrisma.paymentGateway.findUnique.mockResolvedValue(null);
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);
      mockPrisma.payment.create.mockImplementation(async (args: any) => ({
        id: 'pay-new',
        ...args.data,
      }));
      return fn(mockPrisma);
    });
  }

  it('PAID overpay calls grantFromOverpayment inside the tx with marginal args', async () => {
    const svc = await makeService();
    mockPaidCreate({
      id: 'order-1',
      customerId: 'cust-1',
      viewToken: 'tok',
      total: 1000,
      paymentOptionType: 'FULL_PAYMENT',
      partialAmount: null,
      payments: [{ id: 'pay-0', amount: 800, status: 'PAID' }],
    });
    await svc.create(
      'order-1',
      {
        gatewayCode: 'bkash',
        amount: 500,
        account: 'acc-1',
        transactionId: 'TX-C1',
      } as any,
      { userId: 'staff-1', isStaff: true },
    );
    expect(mockCredit.grantFromOverpayment).toHaveBeenCalledTimes(1);
    expect(mockCredit.grantFromOverpayment).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        customerId: 'cust-1',
        orderId: 'order-1',
        paymentId: 'pay-new',
        orderTotal: 1000,
        paidBefore: 800,
        newAmount: 500,
        isPaid: true,
      }),
    );
  });

  it('guest order (no customerId) never grants', async () => {
    const svc = await makeService();
    mockPaidCreate({
      id: 'order-g',
      customerId: null,
      viewToken: 'tok',
      total: 1000,
      paymentOptionType: 'FULL_PAYMENT',
      partialAmount: null,
      payments: [],
    });
    await svc.create(
      'order-g',
      {
        gatewayCode: 'bkash',
        amount: 5000,
        account: 'acc-1',
        transactionId: 'TX-C2',
      } as any,
      { userId: 'staff-1', isStaff: true },
    );
    expect(mockCredit.grantFromOverpayment).not.toHaveBeenCalled();
  });

  it('grant path does NOT double-fire cod recompute (create still calls it exactly once)', async () => {
    const svc = await makeService();
    mockPaidCreate({
      id: 'order-1',
      customerId: 'cust-1',
      viewToken: 'tok',
      total: 1000,
      paymentOptionType: 'FULL_PAYMENT',
      partialAmount: null,
      payments: [],
    });
    await svc.create(
      'order-1',
      {
        gatewayCode: 'bkash',
        amount: 1500,
        account: 'acc-1',
        transactionId: 'TX-C3',
      } as any,
      { userId: 'staff-1', isStaff: true },
    );
    expect(mockCredit.grantFromOverpayment).toHaveBeenCalledTimes(1);
    expect(mockCod.recompute).toHaveBeenCalledTimes(1);
    expect(mockCod.recompute).toHaveBeenCalledWith('order-1');
  });
});

describe('CustomerCreditController guards', () => {
  it('GET :id/credit is staff-only under admin_customers', () => {
    const proto = CustomerCreditController.prototype as any;
    expect(Reflect.getMetadata(ROLES_KEY, proto.getCredit)).toEqual([
      'superadmin',
      'admin',
      'employee',
    ]);
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, proto.getCredit)).toBe(
      'admin_customers',
    );
  });

  it('POST /orders/:id/apply-credit is any-staff (record action, D3) under admin_orders — no approve permission', () => {
    const proto = CustomerCreditController.prototype as any;
    expect(Reflect.getMetadata(ROLES_KEY, proto.applyCredit)).toEqual([
      'superadmin',
      'admin',
      'employee',
    ]);
    expect(Reflect.getMetadata(REQUIRES_FEATURE_KEY, proto.applyCredit)).toBe(
      'admin_orders',
    );
    // Deliberate: applying credit is staff-initiated BY design ("offer apply
    // credit"). Any staff may apply; the actor is recorded in recordedBy /
    // entry.createdBy. approve_payments is for verifying others' entries.
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, proto.applyCredit),
    ).toBeUndefined();
  });
});
