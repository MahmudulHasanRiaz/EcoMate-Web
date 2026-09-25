/**
 * P6 blocked-ingest suite (BR-13/BR-14/BR-15) + R-1 byte-equality + BR-24
 * zero-dispatch + BR-16 shortfall-kept (§13).
 *
 * - Ingest with a blocked phone AND a blocked IP → order created,
 *   ingestFlags set, timeline note written, all later transitions allowed
 *   (flags never add restrictions).
 * - Static negative assertion: no code path can throw/return an error for a
 *   block reason when internal.ingest === 'external_store' (runtime: all
 *   three blocked scenarios resolve; static: no blockedPolicy/reject switch
 *   anywhere).
 * - Bridge contact-check is read-only (zero writes), creates no order.
 * - Native storefront blocking unchanged (guest still 400s).
 * - R-1: a storefront-shaped call writes byte-identical fields as before
 *   (no provenance keys without `internal`; no controller passes `internal`;
 *   CreateOrderDto gains no statusId).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHmac } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../../../orders/orders.service';
import { OrdersEventService } from '../../../orders/orders-event.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TrackingCaptureService } from '../../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../../tracking/tracking-settings.service';
import { TrackingContextService } from '../../../tracking/tracking-context.service';
import { CustomersService } from '../../../customers/customers.service';
import { StockService } from '../../../stock/stock.service';
import { StockRouterService } from '../../../stock/stock-router.service';
import { BlockedEntriesService } from '../../../blocked-entries/blocked-entries.service';
import { SecurityService } from '../../../security/security.service';
import { CouponsService } from '../../../coupons/coupons.service';
import { ManagedStockLedgerService } from '../../../inventory/managed-stock-ledger.service';
import { CostingLotService } from '../../../stock/costing-lot.service';
import { CancelReturnStockService } from '../../../stock/cancel-return-stock.service';
import { OrderStockDeductService } from '../../../stock/order-stock-deduct.service';
import { OrderEditLockService } from '../../../orders/order-edit-lock.service';
import { CommissionsService } from '../../../commissions/commissions.service';
import { TrackingEligibilityGate } from '../../../tracking/tracking-eligibility-gate';
import { StoreBridgeController } from '../..//webhooks/store-bridge.controller';

const INITIAL = { id: 'st-pending', name: 'Pending', isInitial: true };
const CONFIRMED = { id: 'st-confirmed', name: 'Confirmed', isInitial: false };

function txMock(prisma: any, created: any) {
  const tx: any = {
    ...prisma,
    orderCounter: { upsert: jest.fn().mockResolvedValue({ date: '260923', seq: 7 }) },
    order: {
      ...prisma.order,
      create: jest.fn().mockImplementation(async (args: any) => ({ ...created })),
      findUnique: jest.fn().mockResolvedValue({
        ...created,
        items: [{ product: { id: 'prod-2', name: 'Prod 2', sku: 'SKU-2', category: { name: 'Cat' } }, variant: null, combo: null, quantity: 1, price: 500 }],
        payments: [],
      }),
      update: jest.fn().mockImplementation(async (args: any) => args.data),
    },
  };
  return tx;
}

describe('P6 blocked-ingest (BR-13/BR-14/BR-15)', () => {
  let service: OrdersService;
  let prisma: any;
  let blockedEntries: any;
  let customers: any;
  let capture: any;
  let gate: any;

  const guestDto = () => ({
    items: [{ productId: 'prod-2', quantity: 1, price: 500 }],
    guestName: 'Sara K',
    guestPhone: '01700000001',
  });

  const createdBase = {
    id: 'ord-ext-1',
    displayId: 'ORD-260923-0007',
    guestPhone: '8801700000001',
    trackingSessionId: null,
    customer: null,
    items: [{ productId: 'prod-2', variantId: null, comboId: null, quantity: 1, price: 500 }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: {
          $transaction: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([]),
          order: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
          orderStatus: { findFirst: jest.fn(), findUnique: jest.fn() },
          orderItem: { deleteMany: jest.fn() },
          productVariant: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
          product: {
            findUnique: jest.fn(),
            findMany: jest.fn().mockImplementation(async (args: any) => {
              if (args?.where?.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return [];
              return [{
                id: 'prod-2', basePrice: 500, salePrice: null, isActive: true,
                availabilityMode: 'MANAGED_STOCK', name: 'Prod 2', type: 'simple',
                managedStockQuantity: 25, reservedStock: 0,
              }];
            }),
          },
          combo: { findMany: jest.fn().mockResolvedValue([]) },
          coupon: { findUnique: jest.fn(), update: jest.fn() },
          payment: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
          customerProfile: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 'cust-1' }), update: jest.fn() },
          checkoutLead: { updateMany: jest.fn() },
          systemSetting: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
          userProfile: { findUnique: jest.fn().mockResolvedValue({ status: 'active' }), findFirst: jest.fn().mockResolvedValue({ status: 'active' }) },
          trackingSnapshot: { findUnique: jest.fn() },
          trackingOutbox: { findUnique: jest.fn() },
        } },
        { provide: OrdersEventService, useValue: { emit: jest.fn() } },
        { provide: TrackingCaptureService, useValue: { capture: jest.fn().mockResolvedValue({ status: 'CAPTURED' }) } },
        { provide: TrackingSettingsService, useValue: { buildConfigSnapshot: jest.fn().mockResolvedValue({}), get: jest.fn() } },
        { provide: TrackingContextService, useValue: { getByCtxId: jest.fn().mockResolvedValue(null) } },
        { provide: OrderEditLockService, useValue: { getLock: jest.fn().mockResolvedValue(null) } },
        { provide: CustomersService, useValue: { isPhoneBlocked: jest.fn().mockResolvedValue(false), findOrCreateCustomer: jest.fn().mockResolvedValue({ id: 'cust-1' }) } },
        { provide: StockService, useValue: { operate: jest.fn().mockResolvedValue(undefined), reservePhysicalAllocated: jest.fn(), hasExistingPhysicalReservation: jest.fn().mockResolvedValue(false), addPhysical: jest.fn() } },
        { provide: StockRouterService, useValue: { isInventoryManagementEnabled: jest.fn().mockResolvedValue(false), resolve: jest.fn().mockReturnValue({ ms: 'reserve', pi: 'skip' }) } },
        { provide: BlockedEntriesService, useValue: { findOrderBlockedIp: jest.fn().mockResolvedValue(null), findBlockedPhone: jest.fn().mockResolvedValue(null) } },
        { provide: CouponsService, useValue: { validate: jest.fn(), apply: jest.fn() } },
        { provide: SecurityService, useValue: { recordOrder: jest.fn().mockResolvedValue(undefined) } },
        { provide: ManagedStockLedgerService, useValue: { record: jest.fn(), hasExistingRestock: jest.fn().mockResolvedValue(false) } },
        { provide: CostingLotService, useValue: { restoreForReturn: jest.fn() } },
        { provide: CancelReturnStockService, useValue: { restoreForOrder: jest.fn(), holdReservationForReturnPending: jest.fn() } },
        { provide: OrderStockDeductService, useValue: { deductForOrder: jest.fn() } },
        { provide: CommissionsService, useValue: { processOrderCommissions: jest.fn(), reverseForOrder: jest.fn() } },
        { provide: TrackingEligibilityGate, useValue: { checkOrderEvent: jest.fn().mockResolvedValue({ eligible: true, category: 'DIRECT_WEBSITE', configKey: 'x', configValue: true }), isOrderEligible: jest.fn(), requireEligible: jest.fn() } },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get<PrismaService>(PrismaService);
    blockedEntries = module.get<BlockedEntriesService>(BlockedEntriesService);
    customers = module.get<CustomersService>(CustomersService);
    capture = module.get<TrackingCaptureService>(TrackingCaptureService);
    gate = module.get<TrackingEligibilityGate>(TrackingEligibilityGate);
  });

  function mockTxFor(created: any = createdBase) {
    const tx = txMock(prisma, created);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
    return tx;
  }

  const ingestOpts = (extra: Record<string, unknown> = {}) => ({
    ingest: 'external_store' as const,
    storeId: 'store-1',
    externalOrderId: 'ext-1',
    idempotencyKey: 'store:store-1:order:ext-1',
    allowStockShortfall: true,
    skipPurchaseTracking: true,
    ...extra,
  });

  it('blocked phone + blocked IP ingested with flags + timeline notes (no throw)', async () => {
    blockedEntries.findBlockedPhone.mockResolvedValue({ id: 'bp-1' });
    blockedEntries.findOrderBlockedIp.mockResolvedValue({ id: 'bi-1' });
    (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(CONFIRMED);
    const tx = mockTxFor();

    const result: any = await service.create(guestDto() as any, '203.0.113.9', undefined, ingestOpts());

    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.ingestFlags).toEqual(expect.arrayContaining(['BLOCKED_PHONE', 'BLOCKED_IP']));
    expect(data.storeId).toBe('store-1');
    expect(data.externalOrderId).toBe('ext-1');
    expect(data.idempotencyKey).toBe('store:store-1:order:ext-1');
    expect(data.statusId).toBe('st-confirmed');
    const notes = (data.timeline as any[]).map((t) => t.note).join(' | ');
    expect(notes).toContain('blocked phone');
    expect(notes).toContain('blocked IP');
    expect(result).toBeDefined();
  });

  it('suspended customer ingested with SUSPENDED_CUSTOMER flag (no throw)', async () => {
    customers.isPhoneBlocked.mockResolvedValue(true);
    (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(INITIAL);
    const tx = mockTxFor();

    await service.create(guestDto() as any, undefined, undefined, ingestOpts());
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.ingestFlags).toContain('SUSPENDED_CUSTOMER');
  });

  it('initial-status override honored; falls back to initial status when unmapped', async () => {
    (prisma.orderStatus.findFirst as jest.Mock).mockImplementation(async (args: any) => {
      if (args?.where?.name === 'Confirmed') return CONFIRMED;
      return INITIAL;
    });
    const tx = mockTxFor();
    await service.create(guestDto() as any, undefined, undefined, ingestOpts({ initialStatusName: 'Confirmed' }));
    expect(prisma.orderStatus.findFirst).toHaveBeenCalledWith({ where: { name: 'Confirmed' } });
    expect(tx.order.create.mock.calls[0][0].data.statusId).toBe('st-confirmed');
  });

  it('stock shortfall keeps the order with STOCK_SHORTFALL (BR-16)', async () => {
    (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(INITIAL);
    (prisma.product.findMany as jest.Mock).mockResolvedValue([{
      id: 'prod-2', basePrice: 500, salePrice: null, isActive: true,
      availabilityMode: 'MANAGED_STOCK', name: 'Prod 2', type: 'simple',
      managedStockQuantity: 0, reservedStock: 0,
    }]);
    const tx = mockTxFor();
    const stock = (service as any).stockService as any;

    await service.create(guestDto() as any, undefined, undefined, ingestOpts());
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.ingestFlags).toContain('STOCK_SHORTFALL');
    // No reservation attempted for the shortfall item — order kept as-is.
    expect(stock.operate).not.toHaveBeenCalled();
  });

  it('zero tracking dispatch for external orders by default (BR-24)', async () => {
    (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(INITIAL);
    mockTxFor();
    await service.create(guestDto() as any, undefined, undefined, ingestOpts());
    expect(capture.capture).not.toHaveBeenCalled();
    expect(gate.checkOrderEvent).not.toHaveBeenCalled();
  });

  it('native storefront blocking is unchanged (guest 400s)', async () => {
    (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(INITIAL);
    blockedEntries.findBlockedPhone.mockResolvedValue({ id: 'bp-1' });
    await expect(service.create(guestDto() as any, undefined, undefined)).rejects.toThrow(
      'This phone number has been blocked',
    );
    blockedEntries.findBlockedPhone.mockResolvedValue(null);
    blockedEntries.findOrderBlockedIp.mockResolvedValue({ id: 'bi-1' });
    await expect(service.create(guestDto() as any, '203.0.113.9', undefined)).rejects.toThrow(
      'temporarily restricted',
    );
  });

  it('R-1: storefront-shaped call writes byte-identical fields (no internal)', async () => {
    (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(INITIAL);
    const tx = mockTxFor();
    const dtoA = guestDto() as any;
    const dtoB = guestDto() as any;
    await service.create(dtoA, '198.51.100.7', undefined);
    await service.create(dtoB, '198.51.100.7', undefined, undefined);
    const [a, b] = tx.order.create.mock.calls.map((c: any[]) => c[0].data);
    // Nondeterministic per-call values (fresh token + wall-clock timeline
    // stamps) are stripped — R-1 asserts the WRITTEN FIELDS are identical.
    const scrub = (p: any) => {
      const copy = JSON.parse(JSON.stringify(p));
      delete copy.viewToken;
      if (Array.isArray(copy.timeline)) {
        for (const t of copy.timeline) delete t.timestamp;
      }
      return copy;
    };
    expect(scrub(a)).toEqual(scrub(b));
    for (const payload of [a, b]) {
      expect(payload).not.toHaveProperty('storeId');
      expect(payload).not.toHaveProperty('externalOrderId');
      expect(payload).not.toHaveProperty('ingestFlags');
      expect(payload).not.toHaveProperty('idempotencyKey');
      expect(payload).not.toHaveProperty('storeMetadata');
    }
    expect(prisma.orderStatus.findFirst).toHaveBeenCalledWith({ where: { isInitial: true } });
  });

  it('R-1 static: no controller passes internal; CreateOrderDto gains no statusId', () => {
    const src = (rel: string) =>
      fs.readFileSync(path.resolve(__dirname, '..', '..', '..', rel), 'utf8');
    const controller = src('orders/orders.controller.ts');
    expect(controller).not.toMatch(/\.create\([^)]*internal/);
    expect(controller).toMatch(/svc\.create\(dto,/);
    for (const f of [
      'pos/pos-orders.service.ts',
      'checkout-leads/checkout-leads.service.ts',
      'import/order-import.service.ts',
    ]) {
      const body = src(f);
      expect(body).not.toContain('allowStockShortfall');
      expect(body).not.toContain("ingest: 'external_store'");
    }
    const dto = src('orders/dto/order.dto.ts');
    // CreateOrderDto must not gain statusId (a public status override would
    // let a guest create a Delivered order). UpdateOrderStatusDto legitimately
    // owns statusId — scope the assertion to the create class only.
    const createBody = dto.slice(dto.indexOf('export class CreateOrderDto'), dto.indexOf('export class UpdateOrderStatusDto'));
    expect(createBody).not.toContain('statusId');
  });

  it('BR-13 static: no blockedPolicy / reject switch anywhere in the ingest path', () => {
    const src = (rel: string) =>
      fs.readFileSync(path.resolve(__dirname, '..', '..', '..', rel), 'utf8');
    // Mechanism patterns (comments may discuss the rule; only an actual
    // policy/reject mechanism fails): a config key, a reject function, or a
    // should-reject predicate.
    const FORBIDDEN = [
      /blockedPolicy\s*[:=?]/i,
      /blocked_policy/i,
      /rejectExternal/i,
      /reject_external/i,
      /shouldReject/i,
    ];
    for (const f of [
      'orders/orders.service.ts',
      'stores/orders/store-order-ingest.service.ts',
      'stores/orders/store-order-reconcile.service.ts',
      'stores/webhooks/store-webhook.service.ts',
    ]) {
      const body = src(f);
      for (const re of FORBIDDEN) {
        expect(body).not.toMatch(re);
      }
    }
  });
});

describe('P6 bridge contact-check (BR-14) — signed, read-only', () => {
  const secret = 'bridge-secret-1';
  const storeId = 'store-bridge-1';

  function buildController() {
    const prisma: any = {
      store: { findUnique: jest.fn().mockResolvedValue({ id: storeId, kind: 'CUSTOM', status: 'CONNECTED' }) },
      order: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      storeOrderMapping: { create: jest.fn() },
      storeWebhookDelivery: { create: jest.fn() },
    };
    const stores: any = { loadSecrets: jest.fn().mockResolvedValue({ webhookSecret: secret }) };
    const blocked: any = {
      findOrderBlockedIp: jest.fn().mockResolvedValue(null),
      findBlockedPhone: jest.fn().mockResolvedValue(null),
    };
    const cust: any = { isPhoneBlocked: jest.fn().mockResolvedValue(false) };
    const ctrl = new StoreBridgeController(prisma, stores, blocked, cust);
    return { ctrl, prisma, blocked, cust };
  }

  function sign(phone: string, ip: string, ts: string) {
    return createHmac('sha256', secret).update(`${phone}.${ip}.${ts}`).digest('hex');
  }

  it('returns blocked reasons and writes nothing', async () => {
    const { ctrl, prisma, blocked, cust } = buildController();
    blocked.findBlockedPhone.mockResolvedValue({ id: 'bp' });
    cust.isPhoneBlocked.mockResolvedValue(true);
    const ts = String(Math.floor(Date.now() / 1000));
    const phone = '01700000001';
    const res = await ctrl.contactCheck(storeId, phone, '', ts, sign(phone, '', ts));
    expect(res).toEqual({ blocked: true, reasons: expect.arrayContaining(['phone_blocked', 'account_suspended']) });
    // Read-only: zero writes of any kind.
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.order.delete).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.create).not.toHaveBeenCalled();
    expect(prisma.storeWebhookDelivery.create).not.toHaveBeenCalled();
  });

  it('clean contact → not blocked; bad signature / stale timestamp → 401', async () => {
    const { ctrl } = buildController();
    const ts = String(Math.floor(Date.now() / 1000));
    const ok = await ctrl.contactCheck(storeId, '01700000002', '', ts, sign('01700000002', '', ts));
    expect(ok).toEqual({ blocked: false, reasons: [] });
    await expect(ctrl.contactCheck(storeId, '01700000002', '', ts, 'deadbeef')).rejects.toThrow('Unauthorized');
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    await expect(
      ctrl.contactCheck(storeId, '01700000002', '', stale, sign('01700000002', '', stale)),
    ).rejects.toThrow('Unauthorized');
  });
});
