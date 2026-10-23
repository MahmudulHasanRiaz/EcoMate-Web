import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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
import { CustomizationService } from '../../customization/customization.service';
import { OrderStockDeductService } from '../../stock/order-stock-deduct.service';
import { OrderEditLockService } from '../order-edit-lock.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { TrackingEligibilityGate } from '../../tracking/tracking-eligibility-gate';
import { CacheService } from '../../cache/cache.service';
import {
  DispatchCancelService,
  type DispatchCancelPlan,
} from '../../dispatch-cancel/dispatch-cancel.service';

/**
 * Cancel a DISPATCHED order (owner directive, 2026-10-21) — the SERVER-side
 * gate.
 *
 * A shipped order can be cancelled while its dispatch is still cancellable
 * with the courier. The dispatch is cancelled with the courier FIRST; only on
 * success is the order cancelled. A picked-up / handed-over dispatch (or a
 * courier without a cancel API) is refused — a crafted request cannot bypass
 * it. A courier failure leaves the order and the dispatch exactly as they were.
 */
describe('OrdersService — cancel a dispatched order', () => {
  let service: OrdersService;
  let dispatchCancel: DispatchCancelService;
  let prisma: any;
  let courierCancel: jest.Mock;

  const shippingStatus = { id: 'status-ship', name: 'Shipping' };
  const cancelledStatus = { id: 'status-cancelled', name: 'Cancelled' };

  const baseOrder = {
    id: 'order-1',
    displayId: 'ORD-261021-0001',
    kind: 'SALE',
    trashedAt: null,
    assignedToId: null,
    timeline: [],
    total: 2000,
    status: shippingStatus,
    statusId: 'status-ship',
    items: [
      {
        id: 'item-1',
        productId: 'prod-1',
        variantId: null,
        quantity: 2,
        comboId: null,
      },
    ],
  };

  const dispatch = (over: any = {}) => ({
    id: 'dsp-1',
    courier: 'carrybee',
    status: 'DISPATCHED',
    consignmentId: 'CONS-1',
    trackingCode: null,
    pickedUpAt: null,
    handedOverAt: null,
    deliveredAt: null,
    courierStatus: 'order.created',
    courierStatusAt: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ ...baseOrder }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(async (args: any) => ({
          ...baseOrder,
          ...args?.data,
          status: cancelledStatus,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id === 'status-cancelled') return cancelledStatus;
          if (where?.name === 'Cancelled') return cancelledStatus;
          return null;
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          where?.name === 'Cancelled' ? cancelledStatus : null,
        ),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      return: { findMany: jest.fn().mockResolvedValue([]) },
      dispatch: {
        findMany: jest.fn().mockResolvedValue([dispatch()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        DispatchCancelService,
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
        {
          provide: CustomizationService,
          useValue: new CustomizationService({ canUse: () => true } as any),
        },
        {
          provide: CancelReturnStockService,
          useValue: {
            restoreForOrder: jest.fn().mockResolvedValue(undefined),
            releaseForCancellation: jest.fn().mockResolvedValue(undefined),
            restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
            holdReservationForReturnPending: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        {
          provide: OrderStockDeductService,
          useValue: { deductForOrder: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderEditLockService, useValue: {} },
        {
          provide: CommissionsService,
          useValue: {
            processOrderCommissions: jest.fn(),
            reverseForOrder: jest.fn().mockResolvedValue({ reversed: 0 }),
          },
        },
        { provide: TrackingEligibilityGate, useValue: {} },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
    dispatchCancel = module.get<DispatchCancelService>(DispatchCancelService);
    courierCancel = jest
      .spyOn(dispatchCancel as any, 'callCourierCancel')
      .mockResolvedValue({ success: true });
  });

  afterEach(() => jest.restoreAllMocks());

  const cancelOrder = () =>
    service.updateStatus(
      'order-1',
      { statusId: 'status-cancelled' },
      'staff-1',
      'staff@ecomate.com',
    );

  it('an eligible dispatch: the courier cancel is pushed, then the order is cancelled', async () => {
    const result = await cancelOrder();

    expect(courierCancel).toHaveBeenCalledWith(
      'carrybee',
      'CONS-1',
      expect.stringContaining('staff@ecomate.com'),
    );
    expect(result.status).toMatchObject({ name: 'Cancelled' });
    // The dispatch is flipped in the SAME transaction as the order cancel.
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'dsp-1' }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });

  it('a PICKED-UP dispatch is refused by the server (the order stays)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ status: 'PICKED_UP', pickedUpAt: new Date() }),
    ]);

    await expect(cancelOrder()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('Pathao is cancelled through its cancel endpoint (the order proceeds)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ courier: 'pathao', consignmentId: 'PATHAO-9' }),
    ]);

    const result = await cancelOrder();

    expect(courierCancel).toHaveBeenCalledWith(
      'pathao',
      'PATHAO-9',
      expect.stringContaining('staff@ecomate.com'),
    );
    expect(result.status).toMatchObject({ name: 'Cancelled' });
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          courierCancelMode: 'API',
          courierCancelRef: 'PATHAO-9',
        }),
      }),
    );
  });

  it('Steadfast proceeds in MANUAL mode and keeps the panel marker pending', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ courier: 'steadfast', consignmentId: 'SF-1' }),
    ]);

    const result = await cancelOrder();

    // No courier API call — but the order cancel still completes.
    expect(courierCancel).not.toHaveBeenCalled();
    expect(result.status).toMatchObject({ name: 'Cancelled' });
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          courierCancelMode: 'MANUAL',
          courierCancelRef: 'SF-1',
        }),
      }),
    );
  });

  it('a PICKED-UP Steadfast dispatch is STILL refused (manual fallback never bypasses pickup)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({
        courier: 'steadfast',
        status: 'PICKED_UP',
        pickedUpAt: new Date(),
      }),
    ]);

    await expect(cancelOrder()).rejects.toThrow(/already picked up/i);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('a FAILING courier cancel aborts everything (the order stays)', async () => {
    courierCancel.mockRejectedValue(new Error('courier refused'));

    await expect(cancelOrder()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.dispatch.updateMany).not.toHaveBeenCalled();
  });

  it('an order WITHOUT a dispatch cancels exactly as before (no courier call)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([]);

    const result = await cancelOrder();

    expect(result.status).toMatchObject({ name: 'Cancelled' });
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('an automated actor can never cancel a dispatched order', async () => {
    await expect(
      service.updateStatus(
        'order-1',
        { statusId: 'status-cancelled' },
        'system',
        'system',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('the dispatch plan is returned to the caller (the audit carries the reference)', async () => {
    const plan: DispatchCancelPlan = await dispatchCancel.prepare(
      'order-1',
      'staff@ecomate.com',
    );
    expect(plan.outcomes[0]).toMatchObject({
      dispatchId: 'dsp-1',
      courier: 'carrybee',
      reference: 'CONS-1',
    });
  });
});
