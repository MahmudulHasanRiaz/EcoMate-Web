import { Test, TestingModule } from '@nestjs/testing';
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
import { CacheService } from '../../cache/cache.service';

/**
 * Return/Exchange hardening (2): STOCK AUTHORITY (order level).
 *
 * - Order status changes NEVER write stock directly: manual mark-Returned
 *   goes find-or-create linked Return → guarded receive (no restoreForOrder).
 * - No linked Return → one FULL Return is auto-created, then exactly one
 *   guarded restore.
 * - Full receive (linked return already RESTOCKED) → Returned moves with ZERO
 *   stock writes on the status change.
 * - An arrived-but-not-received (REQUESTED/IN_TRANSIT) active return blocks
 *   manual Returned — staff receive it first.
 * - Return Pending / Partial moves are status-only (no stock writes).
 *
 * RED phase: handleReturnedSideEffects still blanket-restores.
 */
describe('OrdersService — return stock authority (hardening 2)', () => {
  let service: OrdersService;
  let prisma: any;
  let cancelReturnStock: any;

  const returnPendingStatus = { id: 'status-rp', name: 'Return Pending' };
  const returnedStatus = { id: 'status-returned', name: 'Returned' };

  const baseOrder = {
    id: 'order-1',
    displayId: 'ORD-260101-0001',
    kind: 'SALE',
    trashedAt: null,
    assignedToId: null,
    timeline: [],
    total: 2000,
    status: returnPendingStatus,
    statusId: 'status-rp',
    items: [
      { id: 'item-1', productId: 'prod-1', variantId: null, quantity: 2, comboId: null },
    ],
  };

  let createdReturn: any = null;

  beforeEach(async () => {
    createdReturn = null;
    cancelReturnStock = {
      restoreForOrder: jest.fn().mockResolvedValue(undefined),
      releaseForCancellation: jest.fn().mockResolvedValue(undefined),
      restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
      holdReservationForReturnPending: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ ...baseOrder }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(async (args: any) => ({
          ...baseOrder,
          ...args?.data,
          status: returnedStatus,
        })),
      },
      orderStatus: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id === 'status-returned') return returnedStatus;
          if (where?.name === 'Returned') return returnedStatus;
          return null;
        }),
      },
      return: {
        findMany: jest.fn().mockResolvedValue([]),
        // A just-created row is visible to the same transaction — mirror that.
        findUnique: jest.fn().mockImplementation(async ({ where }: any) =>
          createdReturn && createdReturn.id === where?.id ? createdReturn : null,
        ),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          createdReturn = {
            id: 'ret-auto',
            displayId: 'RTN-260101-0009',
            createdAt: new Date(),
            stockReconciled: false,
            ...data,
          };
          return createdReturn;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (createdReturn && createdReturn.id === where?.id) {
            createdReturn = { ...createdReturn, ...data };
            return createdReturn;
          }
          return { id: where?.id, orderId: 'order-1', ...data };
        }),
      },
      returnCounter: {
        upsert: jest.fn().mockResolvedValue({ date: '260101', seq: 9 }),
      },
      dispatch: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
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
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
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
  });

  it('no-return manual mark → auto-creates one FULL return + one guarded restore', async () => {
    const result = await service.updateStatus(
      'order-1',
      { statusId: 'status-returned' },
      'staff-123',
    );

    expect(result.status).toMatchObject({ name: 'Returned' });
    // Find-or-create: exactly one FULL return, item-scoped to the order.
    expect(prisma.return.create).toHaveBeenCalledTimes(1);
    expect(prisma.return.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 'order-1', type: 'FULL', status: 'REQUESTED' }),
      }),
    );
    // Guarded path only — NEVER the blanket direct write.
    expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledTimes(1);
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('full receive → Returned moves with ZERO stock writes on the status change', async () => {
    prisma.return.findMany.mockResolvedValue([
      {
        id: 'ret-1',
        displayId: 'RTN-260101-0001',
        orderId: 'order-1',
        type: 'FULL',
        status: 'RESTOCKED',
        items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
        stockReconciled: true,
      },
    ]);

    const result = await service.updateStatus(
      'order-1',
      { statusId: 'status-returned' },
      'staff-123',
    );

    expect(result.status).toMatchObject({ name: 'Returned' });
    expect(prisma.return.create).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('active REQUESTED return blocks manual Returned until it arrives', async () => {
    prisma.return.findMany.mockResolvedValue([
      {
        id: 'ret-1',
        displayId: 'RTN-260101-0001',
        orderId: 'order-1',
        type: 'FULL',
        status: 'REQUESTED',
        items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
        stockReconciled: false,
      },
    ]);

    await expect(
      service.updateStatus('order-1', { statusId: 'status-returned' }, 'staff-123'),
    ).rejects.toThrow(/RTN-260101-0001.*has not arrived/);
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
  });

  it('Return Pending / Partial moves are status-only (no stock writes)', async () => {
    const partialStatus = { id: 'status-partial', name: 'Partial' };
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...baseOrder,
      status: { id: 'status-shipping', name: 'Shipping' },
      statusId: 'status-shipping',
    });
    (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(partialStatus);

    await service.updateStatus('order-1', { statusId: 'status-partial' }, 'staff-123');

    expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
    expect(prisma.return.create).not.toHaveBeenCalled();
  });
});
