/**
 * P6 order suite (§13) — ingest worker: webhook-only / reconcile-only / both
 * → exactly one order; 3-day window; widening bounds; stock-shortfall kept;
 * unmatched-SKU issue + one-click map; status-only reconcile (BR-17).
 *
 * Service-level with mocked Prisma/Orders/Runs; the provider side uses the
 * real FakeProvider (P2 fixture contract) for the reconcile window vectors.
 */
import { StoreOrderIngestService, ZERO_STOCK_REJECT } from '../store-order-ingest.service';
import { StoreOrderReconcileService } from '../store-order-reconcile.service';
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { seedFakeProvider, buildOrderFixtures } from '../../providers/__tests__/fixtures';
import { STATUS_MAP } from '../../../import/order-import.service';

function mockPrisma() {
  return {
    store: { findUnique: jest.fn() },
    storeOrderMapping: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    storeOrderStatusMap: { findUnique: jest.fn(), create: jest.fn() },
    storeSkuMapping: { findUnique: jest.fn(), upsert: jest.fn() },
    productVariant: { findUnique: jest.fn() },
    // P13 ZERO_STOCK_REJECT reads ERP stock here: default null (unresolvable
    // → never reject) so pre-existing vectors keep their behavior; the
    // zero-reject suite below stages real levels per case.
    product: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
    orderStatus: { findFirst: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    syncRun: { update: jest.fn().mockResolvedValue({}) },
    syncRun: { update: jest.fn() },
  } as any;
}

function mockRuns() {
  return {
    begin: jest.fn().mockResolvedValue({ id: 'run-1' }),
    recordItem: jest.fn().mockResolvedValue({}),
    upsertIssue: jest.fn().mockResolvedValue({}),
    finish: jest.fn().mockResolvedValue({}),
  } as any;
}

const CONFIRMED = { id: 'st-confirmed', name: 'Confirmed' };
const CREATED_ORDER = { id: 'ord-1', status: { name: 'Confirmed' }, total: 250 };

function buildIngest(prisma: any, overrides: Record<string, any> = {}) {
  const orders = {
    create: jest.fn().mockResolvedValue({ ...CREATED_ORDER }),
    updateStatus: jest.fn().mockResolvedValue({}),
  };
  const svc = new StoreOrderIngestService(
    prisma,
    orders as any,
    mockRuns(),
    { providerFor: jest.fn() } as any,
    { storeWithSecrets: jest.fn() } as any,
  );
  return { svc, orders, runs: (svc as any).runs };
}

function seedStatusMaps(prisma: any, name = 'Confirmed') {
  prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: name });
  prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-x', name });
}

describe('P6 ingest — webhook creates exactly one order (BR-12)', () => {
  it('creates with the external-store internal contract + provenance', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'CUSTOM', name: 'Bridge' });
    seedStatusMaps(prisma);
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    const { svc, orders } = buildIngest(prisma);

    const res = await svc.ingest('s1', {
      id: 'ext-1', status: 'processing', total: 250, currency: 'BDT',
      createdAt: '2026-09-23T13:00:00.000Z',
      items: [{ sku: 'SKU-IN-001', qty: 1, price: 250 }],
      customer: { phone: '01700000001', name: 'Sara' },
    }, { type: 'WEBHOOK', runId: 'run-1' });

    expect(res).toMatchObject({ orderId: 'ord-1', created: true });
    expect(orders.create).toHaveBeenCalledTimes(1);
    // create(dto, clientIp, user, internal): internal is the FOURTH arg —
    // passing it third would land in `user` and silently disable the ingest
    // contract (live-E2E find).
    expect(orders.create.mock.calls[0]).toHaveLength(4);
    expect(orders.create.mock.calls[0][2]).toBeUndefined();
    const [, , , internal] = orders.create.mock.calls[0];
    expect(internal).toMatchObject({
      ingest: 'external_store',
      storeId: 's1',
      externalOrderId: 'ext-1',
      idempotencyKey: 'store:s1:order:ext-1',
      allowStockShortfall: true,
      skipPurchaseTracking: true,
    });
    expect(prisma.storeOrderMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storeId: 's1', externalOrderId: 'ext-1', orderId: 'ord-1' }),
      }),
    );
  });

  it('persists contact + shipping address onto the created order', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'CUSTOM', name: 'Bridge' });
    seedStatusMaps(prisma);
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    const { svc, orders } = buildIngest(prisma);

    await svc.ingest('s1', {
      id: 'ext-2', status: 'processing', total: 500, currency: 'BDT',
      createdAt: '2026-09-23T13:00:00.000Z',
      items: [{ sku: 'SKU-IN-001', qty: 1, price: 500 }],
      customer: { phone: '01700000002', name: 'Rahim', email: 'r@example.com' },
      shipping: { address_1: 'House 1, Road 2', city: 'Dhaka', postcode: '1205', country: 'BD' },
    }, { type: 'WEBHOOK', runId: 'run-1' });

    const [dto] = orders.create.mock.calls[0];
    expect(dto).toMatchObject({
      guestName: 'Rahim',
      guestPhone: '+8801700000002',
      guestEmail: 'r@example.com',
    });
    expect(dto.shippingAddress).toMatchObject({
      address_1: 'House 1, Road 2',
      city: 'Dhaka',
    });
  });

  it('webhook + reconcile + manual of the same external order → exactly one order', async () => {
    const prisma = mockPrisma();
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'CUSTOM', name: 'Bridge' });
    seedStatusMaps(prisma);
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    // First call misses the mapping; every later call finds it (same status).
    prisma.storeOrderMapping.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ orderId: 'ord-1', externalOrderId: 'ext-9', order: { status: { name: 'Confirmed' }, total: 250 } });
    prisma.storeOrderMapping.create.mockResolvedValue({});
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Confirmed' });
    const { svc, orders } = buildIngest(prisma);
    const raw = {
      id: 'ext-9', status: 'processing', total: 250, currency: 'BDT',
      createdAt: '2026-09-23T13:00:00.000Z',
      items: [{ sku: 'SKU-IN-001', qty: 1, price: 250 }],
    };
    const r1 = await svc.ingest('s1', raw, { type: 'WEBHOOK', runId: 'run-1' });
    const r2 = await svc.ingest('s1', raw, { type: 'RECONCILE', runId: 'run-2' });
    const r3 = await svc.ingest('s1', raw, { type: 'MANUAL', runId: 'run-3' });
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r3.created).toBe(false);
    expect(orders.create).toHaveBeenCalledTimes(1);
    expect(r2.orderId).toBe('ord-1');
    expect(r3.orderId).toBe('ord-1');
  });
});

describe('P6 ingest — unmatched SKU (BR-16 spirit: never lose the order)', () => {
  it('creates product-less + raises UNMATCHED_SKU with a one-click map action', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'CUSTOM', name: 'Bridge' });
    seedStatusMaps(prisma);
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(null); // nothing matches
    const { svc, orders, runs } = buildIngest(prisma);

    await svc.ingest('s1', {
      id: 'ext-u1', status: 'pending', total: 150, currency: 'BDT',
      createdAt: '2026-09-22T12:00:00.000Z',
      items: [{ sku: 'SKU-NOPE-001', qty: 1, price: 150 }],
    }, { type: 'WEBHOOK', runId: 'run-1' });

    expect(orders.create).toHaveBeenCalledTimes(1);
    const [dto, , , internal] = orders.create.mock.calls[0];
    expect(dto.items[0]).toMatchObject({ quantity: 1, price: 150 });
    expect(dto.items[0].productId).toBeUndefined();
    expect(internal.allowProductlessItems).toBe(true);
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 's1', code: 'UNMATCHED_SKU' }),
    );

    // One-click map action: operator maps the SKU; the row is stored.
    prisma.storeSkuMapping.upsert.mockResolvedValue({ storeId: 's1', sku: 'SKU-NOPE-001' });
    await svc.mapSku('s1', 'SKU-NOPE-001', { productId: 'prod-1' });
    expect(prisma.storeSkuMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId_sku: { storeId: 's1', sku: 'SKU-NOPE-001' } } }),
    );
  });
});

describe('P6 status-only reconcile (BR-17)', () => {
  it('same status → no order rewrite, totals/items untouched', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue({
      orderId: 'ord-1', externalOrderId: 'ext-2',
      order: { status: { name: 'Confirmed' }, total: 500 },
    });
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Confirmed' });
    const { svc, orders, runs } = buildIngest(prisma);

    const res = await svc.ingest('s1', {
      id: 'ext-2', status: 'processing', total: 500, currency: 'BDT',
      createdAt: '2026-09-21T11:00:00.000Z', items: [],
    }, { type: 'RECONCILE', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Confirmed' });
    expect(orders.create).not.toHaveBeenCalled();
    expect(orders.updateStatus).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED', reason: expect.stringContaining('totals/items untouched') }),
    );
  });

  it('status change → updateStatus only; totals delta noted, never rewritten', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue({
      orderId: 'ord-1', externalOrderId: 'ext-2',
      order: { status: { name: 'Confirmed' }, total: 500 },
    });
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Delivered' });
    prisma.orderStatus.findFirst.mockResolvedValue({ id: 'st-del', name: 'Delivered' });
    prisma.order.findUnique.mockResolvedValue({ timeline: [] });
    const { svc, orders, runs } = buildIngest(prisma);

    const res = await svc.ingest('s1', {
      id: 'ext-2', status: 'completed', total: 999, currency: 'BDT',
      createdAt: '2026-09-21T11:00:00.000Z', items: [],
    }, { type: 'WEBHOOK', runId: 'run-1' });

    expect(res).toMatchObject({ created: false, status: 'Delivered' });
    expect(orders.updateStatus).toHaveBeenCalledWith(
      'ord-1', { statusId: 'st-del' }, 'webhook', 'store-sync',
    );
    // A timeline note may be appended, but items/totals are never rewritten.
    for (const call of prisma.order.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('items');
      expect(call[0].data).not.toHaveProperty('total');
      expect(call[0].data).not.toHaveProperty('subtotal');
    }
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SUCCESS', reason: expect.stringContaining('STATUS_ONLY_RECONCILE') }),
    );
  });
});

describe('P6 status map seeding (import STATUS_MAP)', () => {
  it('seeds every STATUS_MAP entry once; never overwrites operator edits', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderStatusMap.findUnique.mockResolvedValue(null);
    prisma.storeOrderStatusMap.create.mockResolvedValue({});
    const { svc } = buildIngest(prisma);
    const seeded = await svc.ensureStatusMaps('s1');
    expect(seeded).toBe(Object.keys(STATUS_MAP).length);
    expect(prisma.storeOrderStatusMap.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ externalStatus: 'processing', internalStatusName: 'Confirmed' }) }),
    );

    prisma.storeOrderStatusMap.findUnique.mockResolvedValue({ internalStatusName: 'Custom' });
    const reseeded = await svc.ensureStatusMaps('s1');
    expect(reseeded).toBe(0);
    expect(prisma.storeOrderStatusMap.create).toHaveBeenCalledTimes(Object.keys(STATUS_MAP).length);
  });
});

describe('P6 reconcile — 3-day window + widening bounds (BR-10)', () => {
  function buildReconcile() {
    const prisma = mockPrisma();
    const runs = mockRuns();
    const fake = new FakeProvider();
    seedFakeProvider(fake);
    const ingest = {
      ingest: jest.fn().mockResolvedValue({ orderId: 'ord-1', created: true, status: 'Confirmed', statusChanged: true }),
      providerFor: jest.fn().mockResolvedValue(fake),
    } as any;
    const stores = {
      storeWithSecrets: jest.fn().mockResolvedValue({ id: 's1', kind: 'CUSTOM', settings: {}, secrets: {} }),
    } as any;
    const svc = new StoreOrderReconcileService(prisma, runs, { enqueue: jest.fn() } as any, ingest, stores);
    return { svc, prisma, runs, ingest, fake };
  }

  it('fetches the previous 3 days, paged and bounded', async () => {
    const { svc, fake, runs } = buildReconcile();
    const counts = await svc.runStore('s1', 'run-1', {});
    // 5 fixture orders across 2026-09-20…24 — the 3-day window ending now
    // (2026+) contains none of them, so zero created and a clean finish.
    expect(counts).toMatchObject({ failed: 0 });
    expect(fake.calls.filter((c) => c.method === 'fetchOrders')).toHaveLength(1);
    const args = fake.calls.find((c) => c.method === 'fetchOrders')!.detail as any;
    const spanDays = (new Date(args.until).getTime() - new Date(args.since).getTime()) / 86400000;
    expect(spanDays).toBeCloseTo(3, 5);
    expect(args.pageSize).toBeLessThanOrEqual(50);
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ failed: 0 }));
  });

  it('ingests fixture orders that fall inside the window', async () => {
    const { svc, ingest } = buildReconcile();
    // Opt-in widening: master flags + widening flag on, recorded reason.
    const saved: Record<string, string | undefined> = {};
    for (const k of [
      'THIRD_PARTY_STORES_ENABLED',
      'store_sync_enabled',
      'store_reconcile_enabled',
      'store_reconcile_widening_enabled',
    ]) {
      saved[k] = process.env[k];
      process.env[k] = 'true';
    }
    try {
      const counts = await svc.runStore('s1', 'run-1', {
        requestedDays: 30,
        wideningReason: 'fixture coverage',
      });
      expect((svc as any).prisma.syncRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
          data: expect.objectContaining({ windowDays: 30, wideningReason: 'fixture coverage' }),
        }),
      );
      expect(counts.failed).toBe(0);
      expect(ingest.ingest).toHaveBeenCalled();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('widening without flag/reason or beyond 30 days is clamped', async () => {
    const { svc } = buildReconcile();
    // Kill-switch semantics: widening flag explicitly off → default 3 days.
    const savedWidening = process.env.store_reconcile_widening_enabled;
    process.env.store_reconcile_widening_enabled = 'false';
    try {
      await svc.runStore('s1', 'run-1', { requestedDays: 90, wideningReason: 'x' });
      const data = (svc as any).prisma.syncRun.update.mock.calls[0][0].data;
      expect(data.windowDays).toBe(3);
      expect(data.wideningReason).toBeNull();
    } finally {
      if (savedWidening === undefined) delete process.env.store_reconcile_widening_enabled;
      else process.env.store_reconcile_widening_enabled = savedWidening;
    }

    // Flag on but absurd request → hard-capped at 30.
    const saved2: Record<string, string | undefined> = {};
    for (const k of [
      'THIRD_PARTY_STORES_ENABLED',
      'store_sync_enabled',
      'store_reconcile_enabled',
      'store_reconcile_widening_enabled',
    ]) {
      saved2[k] = process.env[k];
      process.env[k] = 'true';
    }
    try {
      const svc2 = buildReconcile().svc;
      await svc2.runStore('s1', 'run-2', { requestedDays: 90, wideningReason: 'outage' });
      const data2 = (svc2 as any).prisma.syncRun.update.mock.calls[0][0].data;
      expect(data2.windowDays).toBe(30);
      expect(data2.wideningReason).toBe('outage');
    } finally {
      for (const [k, v] of Object.entries(saved2)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('P6 order suite — failed webhook recovered by reconciliation', () => {
  it('a missed webhook order is created by the reconcile funnel with the same identity', async () => {
    const prisma = mockPrisma();
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'CUSTOM', name: 'Bridge' });
    seedStatusMaps(prisma);
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    const { svc, orders } = buildIngest(prisma);
    const fixture = buildOrderFixtures()[0];
    const res = await svc.ingest('s1', { ...fixture }, { type: 'RECONCILE', runId: 'run-9' });
    expect(res.created).toBe(true);
    const [, , , internal] = orders.create.mock.calls[0];
    expect(internal.idempotencyKey).toBe(`store:s1:order:${fixture.id}`);
  });
});

describe('P13 ZERO_STOCK_REJECT — operator-directed deviation from BR-13/BR-16', () => {
  const RAW = {
    id: 'ext-zero-1', status: 'processing', total: 250, currency: 'BDT',
    createdAt: '2026-09-23T13:00:00.000Z',
    items: [{ sku: 'SKU-IN-001', qty: 1, price: 250 }],
    customer: { phone: '01700000001', name: 'Sara' },
  };

  function zeroPrisma(erp: Record<string, any> | null) {
    const prisma = mockPrisma();
    prisma.store.findUnique.mockResolvedValue({ id: 's1', kind: 'CUSTOM', name: 'Bridge' });
    seedStatusMaps(prisma);
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    prisma.storeSkuMapping.findUnique.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    // ERP stock resolution: null (default mock) = unresolvable → never reject.
    prisma.product.findUnique.mockResolvedValue(erp);
    return prisma;
  }

  it('managed stock zero → order NOT created, explicit reason + issue + FAILED item', async () => {
    const prisma = zeroPrisma({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 0, reservedStock: 0,
    });
    const { svc, orders, runs } = buildIngest(prisma);
    await expect(
      svc.ingest('s1', { ...RAW }, { type: 'WEBHOOK', runId: 'run-1' }),
    ).rejects.toThrow(new RegExp(ZERO_STOCK_REJECT));
    expect(orders.create).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.create).not.toHaveBeenCalled();
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 's1', code: ZERO_STOCK_REJECT }),
    );
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED', reason: expect.stringContaining(ZERO_STOCK_REJECT) }),
    );
  });

  it('ALWAYS_OUT_OF_STOCK → rejected; ALWAYS_IN_STOCK → ingested', async () => {
    const outPrisma = zeroPrisma({ id: 'prod-1', availabilityMode: 'ALWAYS_OUT_OF_STOCK' });
    const outSvc = buildIngest(outPrisma);
    await expect(outSvc.svc.ingest('s1', { ...RAW }, { type: 'WEBHOOK' })).rejects.toThrow(
      new RegExp(ZERO_STOCK_REJECT),
    );
    expect(outSvc.orders.create).not.toHaveBeenCalled();

    const inPrisma = zeroPrisma({ id: 'prod-1', availabilityMode: 'ALWAYS_IN_STOCK' });
    const inSvc = buildIngest(inPrisma);
    const res = await inSvc.svc.ingest('s1', { ...RAW }, { type: 'WEBHOOK' });
    expect(res.created).toBe(true);
    expect(inSvc.orders.create).toHaveBeenCalledTimes(1);
  });

  it('variant zero → rejected with the variant SKU in the reason', async () => {
    const prisma = zeroPrisma({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 10, reservedStock: 0,
    });
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'var-1', productId: 'prod-1', managedStockQuantity: 0, reservedStock: 0,
    });
    const { svc, orders } = buildIngest(prisma);
    await expect(
      svc.ingest('s1', { ...RAW }, { type: 'WEBHOOK' }),
    ).rejects.toThrow(/SKU-IN-001/);
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('insufficient-but-nonzero → NOT rejected (BR-16 shortfall path preserved)', async () => {
    const prisma = zeroPrisma({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 2, reservedStock: 0,
    });
    const { svc, orders } = buildIngest(prisma);
    const res = await svc.ingest(
      's1',
      { ...RAW, items: [{ sku: 'SKU-IN-001', qty: 5, price: 250 }] },
      { type: 'WEBHOOK' },
    );
    // Ingest passes through; the real create() flags STOCK_SHORTFALL (BR-16).
    expect(res.created).toBe(true);
    expect(orders.create).toHaveBeenCalledTimes(1);
  });

  it('product-less (unmatched SKU) → never a reject trigger', async () => {
    const prisma = zeroPrisma({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 0, reservedStock: 0,
    });
    prisma.product.findFirst.mockResolvedValue(null);
    const { svc, orders, runs } = buildIngest(prisma);
    const res = await svc.ingest('s1', { ...RAW }, { type: 'WEBHOOK', runId: 'run-1' });
    expect(res.created).toBe(true);
    expect(orders.create).toHaveBeenCalledTimes(1);
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNMATCHED_SKU' }),
    );
  });

  it('mixed zero + nonzero lines → the zero line rejects the whole order', async () => {
    const prisma = zeroPrisma({
      id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 0, reservedStock: 0,
    });
    prisma.storeSkuMapping.findUnique.mockImplementation(async ({ where }: any) =>
      where?.storeId_sku?.sku === 'SKU-HAS-STOCK'
        ? { productId: 'prod-9', variantId: null }
        : null,
    );
    prisma.product.findFirst.mockImplementation(async ({ where }: any) =>
      where?.sku === 'SKU-HAS-STOCK' ? null : { id: 'prod-1' },
    );
    prisma.product.findUnique.mockImplementation(async ({ where }: any) =>
      where?.id === 'prod-9'
        ? { id: 'prod-9', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 9, reservedStock: 0 }
        : { id: 'prod-1', availabilityMode: 'MANAGED_STOCK', managedStockQuantity: 0, reservedStock: 0 },
    );
    const { svc, orders } = buildIngest(prisma);
    await expect(
      svc.ingest(
        's1',
        {
          ...RAW,
          items: [
            { sku: 'SKU-HAS-STOCK', qty: 1, price: 100 },
            { sku: 'SKU-IN-001', qty: 1, price: 250 },
          ],
        },
        { type: 'WEBHOOK' },
      ),
    ).rejects.toThrow(new RegExp(ZERO_STOCK_REJECT));
    expect(orders.create).not.toHaveBeenCalled();
  });
});
