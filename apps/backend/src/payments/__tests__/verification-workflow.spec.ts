import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  PERMISSIONS_KEY,
  Permissions,
} from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  isCatalogueKey,
  PERMISSION_CATALOGUE,
} from '../../permissions/permission-catalogue';
import { PermissionsService } from '../../permissions/permissions.service';
import { PaymentsController } from '../payments.controller';
import { PaymentsService } from '../payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersController } from '../../orders/orders.controller';
import { OrdersService } from '../../orders/orders.service';
import { TrackingCaptureService } from '../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../tracking/tracking-settings.service';
import { TrackingContextService } from '../../tracking/tracking-context.service';
import { CustomersService } from '../../customers/customers.service';
import { CustomerAddressService } from '../../customers/customer-address.service';
import { SalesChannelService } from '../../sales-channel/sales-channel.service';
import { OrdersEventService } from '../../orders/orders-event.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { BlockedEntriesService } from '../../blocked-entries/blocked-entries.service';
import { SecurityService } from '../../security/security.service';
import { CouponsService } from '../../coupons/coupons.service';
import { ManagedStockLedgerService } from '../../inventory/managed-stock-ledger.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { OrderStockDeductService } from '../../stock/order-stock-deduct.service';
import { OrderEditLockService } from '../../orders/order-edit-lock.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { TrackingEligibilityGate } from '../../tracking/tracking-eligibility-gate';

/**
 * Task 6 — verification workflow: S1 routing pins live in
 * ledger-behavior.spec.ts (Task 5, not duplicated here); this file covers
 * the approve permission, the self-approve block on both verify paths,
 * and the approve happy path.
 */

describe('verification workflow catalogue key', () => {
  it('approve_payments is a known catalogue key on the payments module', () => {
    expect(isCatalogueKey('approve_payments')).toBe(true);
    const entry = PERMISSION_CATALOGUE.find((e) => e.key === 'approve_payments');
    expect(entry).toMatchObject({ module: 'payments' });
  });

  it('assertKnownKeys accepts approve_payments (preset writes survive)', () => {
    const svc = new PermissionsService();
    expect(() =>
      svc.assertKnownKeys(['view_orders', 'approve_payments']),
    ).not.toThrow();
  });
});

describe('verification workflow controller guards', () => {
  it.each([
    ['PaymentsController.verify', PaymentsController, 'verify', 'admin_payments'],
    [
      'OrdersController.verifyPayment',
      OrdersController,
      'verifyPayment',
      'admin_orders',
    ],
  ])('%s declares @Permissions(approve_payments)', (_label, ctrl: any, method, feature) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ctrl.prototype[method])).toEqual([
      'approve_payments',
    ]);
    // Roles + feature gates stay stacked (never replaced by the permission).
    expect(Reflect.getMetadata(ROLES_KEY, ctrl.prototype[method])).toEqual([
      'superadmin',
      'admin',
      'employee',
    ]);
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, ctrl.prototype[method]),
    ).toBe(feature);
  });
});

describe('verification workflow guard enforcement (guard-level)', () => {
  let guard: PermissionsGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionsGuard, Reflector],
    }).compile();
    guard = module.get<PermissionsGuard>(PermissionsGuard);
  });

  const ctxFor = (
    controller: any,
    handler: (...args: any[]) => any,
    permissions: string[] | undefined,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions } }),
      }),
    }) as any;

  it.each([
    ['PUT /payments/:id/verify', PaymentsController, 'verify'],
    ['POST /orders/:id/verify-payment', OrdersController, 'verifyPayment'],
  ])('%s 403s a staffer without approve_payments', (_label, ctrl: any, method) => {
    expect(() =>
      guard.canActivate(
        ctxFor(ctrl, ctrl.prototype[method], ['view_orders', 'view_payments']),
      ),
    ).toThrow(ForbiddenException);
  });

  it.each([
    ['PUT /payments/:id/verify', PaymentsController, 'verify'],
    ['POST /orders/:id/verify-payment', OrdersController, 'verifyPayment'],
  ])('%s passes an employee preset holder with approve_payments', (_label, ctrl: any, method) => {
    expect(
      guard.canActivate(
        ctxFor(ctrl, ctrl.prototype[method], ['view_orders', 'approve_payments']),
      ),
    ).toBe(true);
  });

  // Sanity: the decorator import itself is load-bearing — an unused import
  // would leave @Permissions undefined at runtime.
  it('Permissions decorator is defined', () => {
    expect(typeof Permissions).toBe('function');
  });
});

describe('PaymentsService.verify self-approve block', () => {
  let service: PaymentsService;
  const mockPrisma: any = {
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    order: { findUnique: jest.fn(), update: jest.fn() },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  function mockTx(paymentRow: any) {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue(undefined);
      mockPrisma.payment.findUnique.mockResolvedValue(paymentRow);
      mockPrisma.payment.update.mockImplementation(async (args: any) => ({
        ...paymentRow,
        ...args.data,
      }));
      mockPrisma.payment.aggregate.mockResolvedValue({
        _sum: { amount: 500 },
      });
      mockPrisma.order.findUnique.mockResolvedValue({ total: 1000 });
      mockPrisma.order.update.mockImplementation(async (args: any) => ({
        id: 'order-1',
        ...args.data,
      }));
      return fn(mockPrisma);
    });
  }

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

  it('staff cannot approve their own entry (403)', async () => {
    mockTx({
      id: 'pay-1',
      orderId: 'order-1',
      recordedBy: 'staff:u1',
      notes: null,
    });
    await expect(
      service.verify('pay-1', { status: PaymentStatus.PAID } as any, 'u1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.verify('pay-1', { status: PaymentStatus.PAID } as any, 'u1'),
    ).rejects.toThrow('Staff cannot approve their own entry');
    expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  });

  it('another staffer approves: sets verified + verifiedBy/At', async () => {
    mockTx({
      id: 'pay-1',
      orderId: 'order-1',
      recordedBy: 'staff:u1',
      notes: null,
    });
    const updated: any = await service.verify(
      'pay-1',
      { status: PaymentStatus.PAID } as any,
      'u2',
    );
    expect(updated.status).toBe(PaymentStatus.PAID);
    expect(updated.verifiedBy).toBe('u2');
    expect(updated.verifiedAt).toBeInstanceOf(Date);
    expect(mockPrisma.payment.update).toHaveBeenCalledTimes(1);
  });

  it('customer-submitted entry (recordedBy null) is verifiable by staff', async () => {
    mockTx({ id: 'pay-1', orderId: 'order-1', recordedBy: null, notes: null });
    const updated: any = await service.verify(
      'pay-1',
      { status: PaymentStatus.PAID } as any,
      'u9',
    );
    expect(updated.verifiedBy).toBe('u9');
  });
});

const orderStub = (overrides: Record<string, any> = {}) => ({
  ...(Object.fromEntries(
    Object.keys(overrides).map((k) => [k, overrides[k]]),
  ) as any),
});

describe('OrdersService.verifyPayment self-approve block', () => {
  let service: OrdersService;
  const txMocks: any = {
    order: { findUnique: jest.fn(), update: jest.fn() },
    orderStatus: { findUnique: jest.fn() },
    payment: { findMany: jest.fn(), update: jest.fn() },
  };
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(txMocks)),
    order: { findUnique: jest.fn() },
  };

  const verifyingOrder: any = {
    id: 'o1',
    trashedAt: null,
    paymentStatus: 'PAYMENT_VERIFYING',
    status: { name: 'Payment Verifying' },
  };

  function mockVerifyTx(pendingRows: any[]) {
    txMocks.order.findUnique.mockResolvedValue(verifyingOrder);
    txMocks.payment.findMany.mockResolvedValue(pendingRows);
    txMocks.orderStatus.findUnique.mockResolvedValue({
      id: 'st-pp',
      name: 'Payment Pending',
    });
    txMocks.order.update.mockImplementation(async (args: any) => ({
      ...verifyingOrder,
      ...args.data,
    }));
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TrackingCaptureService, useValue: orderStub() },
        { provide: TrackingSettingsService, useValue: orderStub() },
        { provide: TrackingContextService, useValue: orderStub() },
        { provide: CustomersService, useValue: orderStub() },
        { provide: CustomerAddressService, useValue: orderStub() },
        {
          provide: SalesChannelService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              channel: null,
              channelEntity: null,
              sourceSlug: null,
              acquisitionType: null,
              warnings: [],
            }),
          },
        },
        { provide: OrdersEventService, useValue: orderStub() },
        { provide: StockService, useValue: orderStub() },
        { provide: StockRouterService, useValue: orderStub() },
        { provide: BlockedEntriesService, useValue: orderStub() },
        { provide: SecurityService, useValue: orderStub() },
        { provide: CouponsService, useValue: orderStub() },
        { provide: ManagedStockLedgerService, useValue: orderStub() },
        { provide: CostingLotService, useValue: orderStub() },
        { provide: CancelReturnStockService, useValue: orderStub() },
        { provide: OrderStockDeductService, useValue: orderStub() },
        {
          provide: OrderEditLockService,
          useValue: { getLock: jest.fn().mockResolvedValue(null) },
        },
        { provide: CommissionsService, useValue: orderStub() },
        { provide: TrackingEligibilityGate, useValue: orderStub() },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  it('staff cannot verify an order whose PENDING entry they recorded (403)', async () => {
    mockVerifyTx([
      { id: 'pay-1', orderId: 'o1', recordedBy: 'staff:u1', status: 'PENDING' },
    ]);
    await expect(service.verifyPayment('o1', true, 'ok', undefined, 'u1')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.verifyPayment('o1', true, 'ok', undefined, 'u1'),
    ).rejects.toThrow('Staff cannot approve their own entry');
    expect(txMocks.order.update).not.toHaveBeenCalled();
  });

  it('another staffer verifies (reject path, no side effects)', async () => {
    mockVerifyTx([
      { id: 'pay-1', orderId: 'o1', recordedBy: 'staff:u1', status: 'PENDING' },
    ]);
    const updated: any = await service.verifyPayment(
      'o1',
      false,
      'not legit',
      undefined,
      'u2',
    );
    expect(updated.paymentStatus).toBe('PAYMENT_PENDING');
    expect(txMocks.order.update).toHaveBeenCalledTimes(1);
  });

  it('multi-PENDING fee guidance still 400s (kept, not replaced)', async () => {
    mockVerifyTx([
      { id: 'pay-1', orderId: 'o1', recordedBy: 'staff:u1', status: 'PENDING' },
      { id: 'pay-2', orderId: 'o1', recordedBy: null, status: 'PENDING' },
    ]);
    await expect(
      service.verifyPayment('o1', true, 'ok', 25, 'u2'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.verifyPayment('o1', true, 'ok', 25, 'u2'),
    ).rejects.toThrow(/per payment row via PUT \/payments\/:id\/verify/);
  });
});
