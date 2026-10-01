/**
 * Order-owned billing snapshot (plan §5.2, §6.5, §9.3).
 *
 * The central rule: shipping and billing are TWO INDEPENDENT order-owned
 * snapshots. Supplying one never derives, clears, or overwrites the other, and
 * an order that never captured a billing address keeps an EMPTY billing
 * snapshot permanently — fabricating one from the shipping address would
 * invent order history.
 */
import { Test } from '@nestjs/testing';
import { OrdersEventService } from '../orders-event.service';
import { OrderEditLockService } from '../order-edit-lock.service';
import { TrackingCaptureService } from '../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../tracking/tracking-settings.service';
import { TrackingContextService } from '../../tracking/tracking-context.service';
import { TrackingEligibilityGate } from '../../tracking/tracking-eligibility-gate';
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
import { CommissionsService } from '../../commissions/commissions.service';
import { MarketingAttributionService } from '../../marketing/marketing-attribution.service';
import { CacheService } from '../../cache/cache.service';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../prisma/prisma.service';

const SHIPPING = { addressLine: 'House 12, Road 5', district: 'Dhaka', thana: 'Mirpur' };
const BILLING = { addressLine: 'Flat 9B, House 44', district: 'Dhaka', thana: 'Gulshan' };

describe('Order billing snapshot separation', () => {
  let service: OrdersService;
  let prisma: any;
  let tx: any;
  let mockOrder: any;

  beforeEach(async () => {
    mockOrder = {
      id: 'order-1',
      displayId: 'ORD-TEST-0001',
      customerId: 'cust-1',
      customerFirstName: 'Rahim',
      customerLastName: 'Uddin',
      customerEmail: 'rahim@example.com',
      customerPhone: '+8801711111111',
      shippingAddress: SHIPPING,
      billingAddress: {},
      assignedToId: null,
      items: [],
      payments: [],
      statusId: 'st-1',
      subtotal: 1000,
      total: 1000,
      trashedAt: null,
      kind: 'SALE',
    };

    const customerProfile = {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'cust-1' }),
    };
    tx = {
      order: { update: jest.fn(), findUnique: jest.fn() },
      orderItem: { deleteMany: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      payment: { deleteMany: jest.fn() },
      customerProfile,
      orderLock: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    prisma = {
      ...tx,
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      order: {
        findUnique: jest.fn().mockResolvedValue(mockOrder),
        update: jest.fn().mockResolvedValue(mockOrder),
        count: jest.fn().mockResolvedValue(0),
      },
      customerProfile,
      orderItem: tx.orderItem,
      payment: tx.payment,
      orderLock: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: TrackingCaptureService, useValue: { capture: jest.fn() } },
        { provide: TrackingSettingsService, useValue: { buildConfigSnapshot: jest.fn().mockResolvedValue({}) } },
        { provide: TrackingContextService, useValue: { getByCtxId: jest.fn().mockResolvedValue(null) } },
        { provide: CustomersService, useValue: { isPhoneBlocked: jest.fn().mockResolvedValue(false) } },
        { provide: CustomerAddressService, useValue: { syncFromOrder: jest.fn().mockResolvedValue(0) } },
        {
          provide: SalesChannelService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              channel: null, channelEntity: null, sourceSlug: null,
              acquisitionType: null, warnings: [],
            }),
          },
        },
        { provide: OrdersEventService, useValue: {} },
        { provide: StockService, useValue: {} },
        { provide: StockRouterService, useValue: {} },
        { provide: BlockedEntriesService, useValue: {} },
        { provide: SecurityService, useValue: {} },
        { provide: CouponsService, useValue: {} },
        { provide: ManagedStockLedgerService, useValue: {} },
        { provide: CostingLotService, useValue: {} },
        { provide: CancelReturnStockService, useValue: {} },
        { provide: OrderStockDeductService, useValue: {} },
        { provide: OrderEditLockService, useValue: {} },
        { provide: CommissionsService, useValue: {} },
        { provide: TrackingEligibilityGate, useValue: { checkOrderEvent: jest.fn().mockResolvedValue(true) } },
        { provide: MarketingAttributionService, useValue: {} },
        { provide: CacheService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
  });

  it('stores an explicitly supplied billing address exactly as given', async () => {
    await service.updateOrder('order-1', { billingAddress: BILLING });
    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.billingAddress).toEqual(BILLING);
  });

  it('NEVER fabricates a billing address from the shipping address', async () => {
    // Order captured no billing data. Shipping is present and populated.
    await service.updateOrder('order-1', { shippingAddress: SHIPPING });
    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.shippingAddress).toEqual(SHIPPING);
    // billingAddress must not appear at all — leaving it untouched, not derived.
    expect(data).not.toHaveProperty('billingAddress');
    expect(data.billingAddress).not.toEqual(SHIPPING);
  });

  it('a shipping edit does not implicitly edit the billing snapshot', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...mockOrder,
      shippingAddress: SHIPPING,
      billingAddress: BILLING,
    });
    await service.updateOrder('order-1', {
      shippingAddress: { addressLine: 'House 99, Road 9' },
    });
    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.shippingAddress).toEqual({ addressLine: 'House 99, Road 9' });
    expect(data).not.toHaveProperty('billingAddress');
  });

  it('a billing edit does not implicitly edit the shipping snapshot', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...mockOrder,
      shippingAddress: SHIPPING,
      billingAddress: BILLING,
    });
    await service.updateOrder('order-1', { billingAddress: { addressLine: 'Office 2' } });
    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.billingAddress).toEqual({ addressLine: 'Office 2' });
    expect(data).not.toHaveProperty('shippingAddress');
  });

  it('leaves an existing billing snapshot completely intact when neither is sent', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...mockOrder,
      shippingAddress: SHIPPING,
      billingAddress: BILLING,
    });
    await service.updateOrder('order-1', { customerNotes: 'call first' });
    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.customerNotes).toBe('call first');
    expect(data).not.toHaveProperty('billingAddress');
    expect(data).not.toHaveProperty('shippingAddress');
  });

  it('address-book BILLING seeding is independent of the order billing snapshot', async () => {
    // The address book may seed a BILLING *role* record from shipping, but that
    // is address-book initialisation — it must never write the order's own
    // historical billing snapshot.
    const addrSvc = (service as any).customerAddressService;
    await service.updateOrder('order-1', { shippingAddress: SHIPPING });
    const data = tx.order.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('billingAddress');
    // syncFromOrder is a separate, explicitly-invoked operation.
    expect(addrSvc.syncFromOrder).not.toHaveBeenCalled();
  });
});
