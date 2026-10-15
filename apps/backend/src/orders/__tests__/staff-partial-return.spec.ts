import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from '../orders.service';
import { OrdersEventService } from '../orders-event.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingCaptureService } from '../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../tracking/tracking-settings.service';
import { TrackingContextService } from '../../tracking/tracking-context.service';
import { CustomersService } from '../../customers/customers.service';
import { CustomerAddressService } from '../../customers/customer-address.service';
import { SalesChannelService } from '../../sales-channel/sales-channel.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { BlockedEntriesService } from '../../blocked-entries/blocked-entries.service';
import { SecurityService } from '../../security/security.service';
import { CouponsService } from '../../coupons/coupons.service';
import { ManagedStockLedgerService } from '../../inventory/managed-stock-ledger.service';
import { CostingLotService } from '../../stock/costing-lot.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import { OrderStockDeductService } from '../../stock/order-stock-deduct.service';
import { OrderEditLockService } from '../order-edit-lock.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { TrackingEligibilityGate } from '../../tracking/tracking-eligibility-gate';

/**
 * Task 5 (Fix 9, owner-locked Rule 15 + 15.4): staff-partial flow.
 *
 * - Button 'Create Partial Return Order' on Shipping AND Partial orders →
 *   creates Return(PARTIAL, items=marked products) → order → Partial,
 *   DISPATCH UNCHANGED (a staff action never rewrites the dispatch).
 * - Remaining order Partial → Delivered after (never direct).
 * - Delivered→Partial LOCK (transition map is actor-independent).
 * - instantDelivery variant: Delivered at creation → later partial webhook
 *   is a no-op.
 */
describe('OrdersService — staff-partial flow (Task 5 Fix 9)', () => {
  let service: OrdersService;
  let prisma: any;
  let tx: any;

  const shippingStatus = { id: 'status-shipping', name: 'Shipping' };
  const partialStatus = { id: 'status-partial', name: 'Partial' };
  const deliveredStatus = { id: 'status-delivered', name: 'Delivered' };
  const returnPendingStatus = { id: 'status-rp', name: 'Return Pending' };
  const confirmedStatus = { id: 'status-confirmed', name: 'Confirmed' };

  const statusById: Record<string, any> = {
    'status-shipping': shippingStatus,
    'status-partial': partialStatus,
    'status-delivered': deliveredStatus,
    'status-rp': returnPendingStatus,
    'status-confirmed': confirmedStatus,
  };

  const orderLines = [
    { productId: 'prod-1', variantId: null, quantity: 2 },
    { productId: 'prod-2', variantId: null, quantity: 1 },
  ];

  function makeOrder(status: any, overrides: any = {}) {
    return {
      id: 'order-1',
      displayId: 'ORD-260930-0001',
      kind: 'SALE',
      statusId: status.id,
      status,
      trashedAt: null,
      assignedToId: null,
      timeline: [],
      total: 2000,
      subtotal: 1900,
      items: orderLines.map((l, i) => ({
        id: `item-${i + 1}`,
        orderId: 'order-1',
        ...l,
        price: 500,
      })),
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = {
      order: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(async (args: any) => ({
          ...makeOrder(partialStatus),
          statusId: args?.data?.statusId,
          status: statusById[args?.data?.statusId] ?? partialStatus,
          timeline: args?.data?.timeline ?? [],
        })),
      },
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
      returnCounter: {
        upsert: jest.fn().mockResolvedValue({ date: '261014', seq: 7 }),
      },
    };
    prisma = {
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          const all = [
            shippingStatus,
            partialStatus,
            deliveredStatus,
            returnPendingStatus,
            confirmedStatus,
          ];
          if (where?.name) return all.find((s) => s.name === where.name) ?? null;
          if (where?.id) return all.find((s) => s.id === where.id) ?? null;
          return null;
        }),
      },
      return: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'ret-1',
          displayId: 'RTN-261014-0007',
          ...data,
        })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      returnCounter: {
        upsert: jest.fn().mockResolvedValue({ date: '261014', seq: 7 }),
      },
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
        create: jest.fn(),
      },
      systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) =>
        typeof cb === 'function' ? cb(tx) : cb,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: TrackingCaptureService, useValue: { capture: jest.fn() } },
        {
          provide: TrackingSettingsService,
          useValue: { buildConfigSnapshot: jest.fn().mockResolvedValue({}) },
        },
        { provide: TrackingContextService, useValue: {} },
        { provide: CustomersService, useValue: {} },
        { provide: CustomerAddressService, useValue: {} },
        { provide: SalesChannelService, useValue: {} },
        { provide: OrdersEventService, useValue: { emit: jest.fn() } },
        { provide: StockService, useValue: {} },
        { provide: StockRouterService, useValue: {} },
        { provide: BlockedEntriesService, useValue: {} },
        { provide: SecurityService, useValue: {} },
        { provide: CouponsService, useValue: {} },
        { provide: ManagedStockLedgerService, useValue: {} },
        { provide: CostingLotService, useValue: {} },
        { provide: CancelReturnStockService, useValue: {} },
        {
          provide: OrderStockDeductService,
          useValue: { deductForOrder: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderEditLockService, useValue: {} },
        {
          provide: CommissionsService,
          useValue: { processOrderCommissions: jest.fn() },
        },
        {
          provide: TrackingEligibilityGate,
          useValue: { checkOrderEvent: jest.fn().mockResolvedValue({ eligible: false }) },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  const actor = { userId: 'staff-1', email: 'staff@ecomate.com' };
  const items = [{ productId: 'prod-1', variantId: null, quantity: 1 }];

  describe('createStaffPartialReturn', () => {
    it('staff-from-Shipping → creates Return(PARTIAL/STAFF) + order → Partial, dispatch UNCHANGED', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      tx.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));

      const result = await (service as any).createStaffPartialReturn(
        'order-1',
        { items },
        actor,
      );

      // ONE Return row, staff-sourced, adopted shape (T4 rows compatible).
      expect(prisma.return.create).toHaveBeenCalledTimes(1);
      expect(prisma.return.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          type: 'PARTIAL',
          source: 'STAFF',
          items,
        }),
      });
      // Order advanced Shipping → Partial.
      expect(result.order.status.name).toBe('Partial');
      // DISPATCH UNCHANGED: a staff action never rewrites the dispatch.
      expect(prisma.dispatch.update).not.toHaveBeenCalled();
      expect(prisma.dispatch.updateMany).not.toHaveBeenCalled();
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(prisma.dispatch.create).not.toHaveBeenCalled();
    });

    it('staff-from-Partial (already Partial) → Return created, status kept, dispatch UNCHANGED', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(partialStatus));

      const result = await (service as any).createStaffPartialReturn(
        'order-1',
        { items, reason: 'size issue' },
        actor,
      );

      expect(prisma.return.create).toHaveBeenCalledTimes(1);
      expect(prisma.return.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'PARTIAL', source: 'STAFF' }),
      });
      expect(result.return).toBeDefined();
      expect(prisma.dispatch.update).not.toHaveBeenCalled();
      expect(prisma.dispatch.updateMany).not.toHaveBeenCalled();
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
      expect(prisma.dispatch.create).not.toHaveBeenCalled();
    });

    it('instantDelivery from Shipping → Return created + order Delivered at creation', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      tx.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));

      const result = await (service as any).createStaffPartialReturn(
        'order-1',
        { items, instantDelivery: true },
        actor,
      );

      expect(prisma.return.create).toHaveBeenCalledTimes(1);
      expect(result.order.status.name).toBe('Delivered');
      expect(prisma.dispatch.update).not.toHaveBeenCalled();
      expect(prisma.dispatch.updateMany).not.toHaveBeenCalled();
      expect(prisma.dispatch.upsert).not.toHaveBeenCalled();
    });

    it('instantDelivery on an already-Partial order → Delivered via the 15.4 path', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(partialStatus));
      tx.order.findUnique.mockResolvedValue(makeOrder(partialStatus));
      // The Return created above satisfies the 15.4 staff-Return check.
      prisma.return.findFirst.mockResolvedValue({
        id: 'ret-1',
        displayId: 'RTN-261014-0007',
        source: 'STAFF',
        type: 'PARTIAL',
        status: 'REQUESTED',
      });

      const result = await (service as any).createStaffPartialReturn(
        'order-1',
        { items, instantDelivery: true },
        actor,
      );

      expect(prisma.return.create).toHaveBeenCalledTimes(1);
      expect(result.order.status.name).toBe('Delivered');
    });

    it.each(['Delivered', 'Confirmed', 'Return Pending', 'Returned', 'Cancelled'])(
      'rejects creation from %s status (Shipping AND Partial only)',
      async (statusName) => {
        prisma.order.findUnique.mockResolvedValue(
          makeOrder({ id: `st-${statusName}`, name: statusName }),
        );
        await expect(
          (service as any).createStaffPartialReturn('order-1', { items }, actor),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.return.create).not.toHaveBeenCalled();
      },
    );

    it('rejects a Return-kind order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder(shippingStatus, { kind: 'RETURN' }),
      );
      await expect(
        (service as any).createStaffPartialReturn('order-1', { items }, actor),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.return.create).not.toHaveBeenCalled();
    });

    it('hardening (1): an active FULL return blocks a second staff partial', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      prisma.return.findMany.mockResolvedValue([
        {
          id: 'ret-full',
          displayId: 'RTN-261014-0001',
          orderId: 'order-1',
          type: 'FULL',
          status: 'REQUESTED',
          items: [],
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
      ]);
      await expect(
        (service as any).createStaffPartialReturn('order-1', { items }, actor),
      ).rejects.toThrow(/already has an active return RTN-261014-0001/);
      expect(prisma.return.create).not.toHaveBeenCalled();
    });

    it('hardening (1): requested qty is capped at ordered − already-returned', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      prisma.return.findMany.mockResolvedValue([
        {
          id: 'ret-p1',
          displayId: 'RTN-261014-0002',
          orderId: 'order-1',
          type: 'PARTIAL',
          status: 'REQUESTED',
          items: [{ productId: 'prod-1', variantId: null, quantity: 1 }],
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
      ]);
      // prod-1 ordered ×2, returned ×1 → only 1 left; requesting 2 fails.
      await expect(
        (service as any).createStaffPartialReturn(
          'order-1',
          { items: [{ productId: 'prod-1', variantId: null, quantity: 2 }] },
          actor,
        ),
      ).rejects.toThrow(/Only 1 left to return/);
      expect(prisma.return.create).not.toHaveBeenCalled();
    });

    it('rejects empty items', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      await expect(
        (service as any).createStaffPartialReturn('order-1', { items: [] }, actor),
      ).rejects.toThrow(/at least one/i);
      expect(prisma.return.create).not.toHaveBeenCalled();
    });

    it('rejects an item not on the original order', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      await expect(
        (service as any).createStaffPartialReturn(
          'order-1',
          { items: [{ productId: 'prod-999', variantId: null, quantity: 1 }] },
          actor,
        ),
      ).rejects.toThrow(/not part of the original order/i);
      expect(prisma.return.create).not.toHaveBeenCalled();
    });

    it('rejects a quantity exceeding the ordered quantity', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      await expect(
        (service as any).createStaffPartialReturn(
          'order-1',
          { items: [{ productId: 'prod-1', variantId: null, quantity: 99 }] },
          actor,
        ),
      ).rejects.toThrow(/exceeds the ordered quantity/i);
      expect(prisma.return.create).not.toHaveBeenCalled();
    });

    it('404s on a missing order', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(
        (service as any).createStaffPartialReturn('order-1', { items }, actor),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmStaffPartialDelivered (15.4 exception)', () => {
    it('promotes Partial → Delivered when an open staff PARTIAL Return exists', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(partialStatus));
      prisma.return.findFirst.mockResolvedValue({
        id: 'ret-1',
        displayId: 'RTN-261014-0007',
        source: 'STAFF',
        type: 'PARTIAL',
        status: 'REQUESTED',
      });
      tx.order.findUnique.mockResolvedValue(makeOrder(partialStatus));

      const result = await (service as any).confirmStaffPartialDelivered(
        'order-1',
        'system',
      );

      expect(prisma.return.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          orderId: 'order-1',
          source: 'STAFF',
          type: 'PARTIAL',
        }),
      });
      expect(result.status.name).toBe('Delivered');
    });

    it('fail-closed: throws when NO staff Return exists (generic Partial stays locked)', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(partialStatus));
      prisma.return.findFirst.mockResolvedValue(null);

      await expect(
        (service as any).confirmStaffPartialDelivered('order-1', 'system'),
      ).rejects.toThrow(/staff-created partial return/i);
    });

    it('fail-closed: throws when the order is not Partial', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder(shippingStatus));
      await expect(
        (service as any).confirmStaffPartialDelivered('order-1', 'system'),
      ).rejects.toThrow(/only a Partial order/i);
    });
  });

  describe('Delivered→Partial LOCK (covers the staff-Return case)', () => {
    it.each(['staff-1', 'system', 'webhook', 'reconcile'])(
      'updateStatus rejects Delivered → Partial for actor %s (lock is actor-independent)',
      async (actorId) => {
        prisma.order.findUnique.mockResolvedValue(makeOrder(deliveredStatus));
        prisma.orderStatus.findUnique.mockImplementation(async ({ where }: any) => {
          if (where?.id === 'status-partial') return partialStatus;
          if (where?.name === 'Partial') return partialStatus;
          return null;
        });
        await expect(
          service.updateStatus('order-1', { statusId: 'status-partial' }, actorId),
        ).rejects.toThrow(/Cannot transition from "Delivered" to "Partial"/);
        expect(prisma.order.update).not.toHaveBeenCalled();
      },
    );
  });
});
