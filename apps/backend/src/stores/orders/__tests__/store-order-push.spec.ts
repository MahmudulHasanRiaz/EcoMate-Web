/**
 * P7 order-status-push suite (§8.6, BR-17).
 *
 * Service-level with mocked Prisma/Runs/Queues/Stores; the provider side
 * uses the real FakeProvider (P2 fixture contract, extended in P7 with a
 * remote order-status map + readOrderStatus) so push → read-back → mapping
 * update is proven end-to-end without HTTP. WooCommerce live HTTP (PUT +
 * GET /orders/{id}) is proven in woo-live.spec.ts.
 *
 * Vectors: pure target resolution (incl. Shopify-style uppercase targets);
 * cancel→cancelled + Delivered→completed read-back-verified; idempotent
 * second run (zero provider calls); unsupported target / update-disabled /
 * Returned explicit skips; non-mapped orders never pushed; stale payload
 * superseded; transient → retry scheduled; permanent → DEAD + issue;
 * verify-mismatch → exactly one repair push then failure.
 */
import { StoreOrderPushService, targetForEcoStatus } from '../store-order-push.service';
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';

const FLAGS = {
  THIRD_PARTY_STORES_ENABLED: 'true',
  store_sync_enabled: 'true',
  store_order_sync_enabled: 'true',
  store_order_push_enabled: 'true',
};

function mockPrisma() {
  return {
    storeOrderMapping: { findUnique: jest.fn(), update: jest.fn() },
    order: { findUnique: jest.fn() },
    store: { findUnique: jest.fn() },
  } as any;
}

function mockRuns() {
  return {
    begin: jest.fn().mockResolvedValue({ id: 'run-1' }),
    recordItem: jest.fn().mockResolvedValue({}),
    recordAttempt: jest.fn().mockResolvedValue({}),
    upsertIssue: jest.fn().mockResolvedValue({}),
    finish: jest.fn().mockResolvedValue({}),
  } as any;
}

function mockQueues() {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    serializeStore: jest.fn((_id: string, work: () => Promise<unknown>) => work()),
  } as any;
}

function mockStores() {
  return {
    storeWithSecrets: jest.fn().mockResolvedValue({
      id: 's1', kind: 'CUSTOM', settings: {}, secrets: {},
    }),
  } as any;
}

function buildPush(prisma: any, provider: any, queues?: any) {
  const runs = mockRuns();
  const q = queues ?? mockQueues();
  const registry = { providerFor: jest.fn().mockReturnValue(provider) };
  const stores = mockStores();
  const svc = new StoreOrderPushService(prisma, registry as any, runs, q, stores);
  return { svc, runs, queues: q, registry, stores };
}

const CONNECTED_STORE = { id: 's1', kind: 'CUSTOM', status: 'CONNECTED', settings: {} };
const MAPPING = (overrides: Record<string, unknown> = {}) => ({
  id: 'map-1', storeId: 's1', externalOrderId: 'ext-1', orderId: 'o1',
  lastExternalStatus: 'processing', lastPushedStatus: null,
  ...overrides,
});
const ORDER = (statusName: string) => ({ id: 'o1', trashedAt: null, status: { name: statusName } });

function seedPushable(prisma: any, statusName: string, mappingOverrides = {}) {
  prisma.storeOrderMapping.findUnique.mockResolvedValue(MAPPING(mappingOverrides));
  prisma.order.findUnique.mockResolvedValue(ORDER(statusName));
  prisma.store.findUnique.mockResolvedValue({ ...CONNECTED_STORE });
}

beforeEach(() => {
  Object.assign(process.env, FLAGS);
});

afterEach(() => {
  delete process.env.THIRD_PARTY_STORES_ENABLED;
  delete process.env.store_sync_enabled;
  delete process.env.store_order_sync_enabled;
  delete process.env.store_order_push_enabled;
  jest.restoreAllMocks();
});

describe('P7 target resolution (pure, capability-driven — never slug-branched)', () => {
  it('Cancelled → cancelled, Delivered → completed on Woo-style targets', () => {
    expect(targetForEcoStatus('Cancelled', ['cancelled', 'completed'])).toEqual({ target: 'cancelled' });
    expect(targetForEcoStatus('Delivered', ['cancelled', 'completed'])).toEqual({ target: 'completed' });
  });

  it('resolves case-insensitively (Shopify P9 CANCELLED/FULFILLED declaration)', () => {
    expect(targetForEcoStatus('Cancelled', ['CANCELLED', 'FULFILLED'])).toEqual({ target: 'cancelled' });
    expect(targetForEcoStatus('Delivered', ['CANCELLED', 'FULFILLED'])).toEqual({ target: 'completed' });
  });

  it('Returned has no phase-1 target → explicit skip (never a wrong-status push)', () => {
    expect(targetForEcoStatus('Returned', ['cancelled', 'completed'])).toEqual({
      skipped: 'NO_PUSH_TARGET_FOR_RETURNED',
    });
  });

  it('absent target → UNSUPPORTED_TARGET; non-pushable status → NOT_PUSHABLE_STATUS', () => {
    expect(targetForEcoStatus('Cancelled', ['completed'])).toEqual({ skipped: 'UNSUPPORTED_TARGET:cancelled' });
    expect(targetForEcoStatus('Hold', ['cancelled', 'completed'])).toEqual({ skipped: 'NOT_PUSHABLE_STATUS:Hold' });
  });
});

describe('P7 notify — post-commit enqueue, non-propagating', () => {
  it('enqueues for a mapped order in a pushable status', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(MAPPING());
    prisma.order.findUnique.mockResolvedValue(ORDER('Cancelled'));
    const { svc, queues } = buildPush(prisma, new FakeProvider());
    await svc.notifyOrderStatusChanged('o1');
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
    expect(queues.enqueue).toHaveBeenCalledWith(
      'store-order-push',
      'order-status-push',
      expect.objectContaining({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' }),
      expect.stringMatching(/^order-push:s1:o1:Cancelled:/),
    );
  });

  it('never enqueues for non-mapped (native/manual/POS) orders', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    const { svc, queues } = buildPush(prisma, new FakeProvider());
    await svc.notifyOrderStatusChanged('o-native');
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('never enqueues for non-pushable statuses', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(MAPPING());
    prisma.order.findUnique.mockResolvedValue(ORDER('Confirmed'));
    const { svc, queues } = buildPush(prisma, new FakeProvider());
    await svc.notifyOrderStatusChanged('o1');
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('flag off → no enqueue, no throw', async () => {
    delete process.env.store_order_push_enabled;
    const prisma = mockPrisma();
    const { svc, queues } = buildPush(prisma, new FakeProvider());
    await expect(svc.notifyOrderStatusChanged('o1')).resolves.toBeUndefined();
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.findUnique).not.toHaveBeenCalled();
  });
});

describe('P7 worker — cancel→cancelled, read-back-verified, mapping updated', () => {
  it('pushes cancelled + verifies by read-back + writes lastPushedStatus', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Cancelled');
    const fake = new FakeProvider();
    const { svc, runs } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(out).toMatchObject({ status: 'SUCCESS', reason: 'PUSHED:cancelled' });
    // Provider saw exactly one push + the read-back read.
    expect(fake.calls.filter((c) => c.method === 'pushOrderStatus')).toHaveLength(1);
    expect(fake.calls.find((c) => c.method === 'pushOrderStatus')?.detail).toMatchObject({
      ref: { providerId: 'ext-1' }, target: 'cancelled',
    });
    expect(fake.calls.some((c) => c.method === 'readOrderStatus')).toBe(true);
    expect(fake.remoteOrderStatus('ext-1')).toBe('cancelled');
    // Mapping updated — the idempotency key for replays.
    expect(prisma.storeOrderMapping.update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { lastPushedStatus: 'cancelled' },
    });
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SUCCESS', reason: expect.stringContaining('read-back verified') }),
    );
  });

  it('Delivered → completed, read-back-verified', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Delivered');
    const fake = new FakeProvider();
    const { svc } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Delivered' });

    expect(out).toMatchObject({ status: 'SUCCESS', reason: 'PUSHED:completed' });
    expect(fake.remoteOrderStatus('ext-1')).toBe('completed');
    expect(prisma.storeOrderMapping.update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { lastPushedStatus: 'completed' },
    });
  });

  it('idempotent: second run with the same target no-ops with ZERO provider calls', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Cancelled', { lastPushedStatus: 'cancelled' });
    const fake = new FakeProvider();
    const { svc, runs } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(out).toMatchObject({ status: 'SKIPPED' });
    expect(out.reason).toMatch(/ALREADY_PUSHED:cancelled/);
    // Zero remote-touching provider calls (capability resolution is a local
    // read — FakeProvider logs it, real adapters do no HTTP for it).
    expect(fake.calls.filter((c) => c.method !== 'resolveCapabilities')).toHaveLength(0);
    expect(prisma.storeOrderMapping.update).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED', reason: expect.stringContaining('ALREADY_PUSHED') }),
    );
  });
});

describe('P7 worker — explicit skips (never silent)', () => {
  function stubProvider(caps: Record<string, unknown>) {
    return {
      slug: 'custom',
      declaredCapabilities: caps,
      resolveCapabilities: jest.fn().mockResolvedValue(caps),
      pushOrderStatus: jest.fn().mockResolvedValue({ ok: true }),
      readOrderStatus: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    } as any;
  }

  it('unsupported target → SKIPPED UNSUPPORTED_TARGET, zero provider writes', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Cancelled');
    const provider = stubProvider({ orderStatusUpdate: true, orderStatusUpdateTargets: ['completed'] });
    const { svc, runs } = buildPush(prisma, provider);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(out.status).toBe('SKIPPED');
    expect(out.reason).toMatch(/UNSUPPORTED_TARGET:cancelled/);
    expect(provider.pushOrderStatus).not.toHaveBeenCalled();
    expect(provider.readOrderStatus).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.update).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('orderStatusUpdate:false → SKIPPED ORDER_STATUS_UPDATE_UNSUPPORTED', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Delivered');
    const provider = stubProvider({ orderStatusUpdate: false, orderStatusUpdateTargets: [] });
    const { svc } = buildPush(prisma, provider);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Delivered' });

    expect(out.status).toBe('SKIPPED');
    expect(out.reason).toMatch(/ORDER_STATUS_UPDATE_UNSUPPORTED/);
    expect(provider.pushOrderStatus).not.toHaveBeenCalled();
  });

  it('Returned → SKIPPED NO_PUSH_TARGET_FOR_RETURNED, zero provider writes', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Returned');
    const fake = new FakeProvider();
    const { svc } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Returned' });

    expect(out.status).toBe('SKIPPED');
    expect(out.reason).toMatch(/NO_PUSH_TARGET_FOR_RETURNED/);
    expect(fake.calls.filter((c) => c.method !== 'resolveCapabilities')).toHaveLength(0);
    expect(prisma.storeOrderMapping.update).not.toHaveBeenCalled();
  });

  it('non-mapped order → SKIPPED MAPPING_GONE, provider never resolved', async () => {
    const prisma = mockPrisma();
    prisma.storeOrderMapping.findUnique.mockResolvedValue(null);
    const fake = new FakeProvider();
    const { svc, registry } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o-ghost', ecoStatus: 'Cancelled' });

    expect(out.status).toBe('SKIPPED');
    expect(out.reason).toMatch(/MAPPING_GONE/);
    expect(registry.providerFor).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

  it('stale payload (re-hold after cancel enqueue) → SKIPPED STATUS_SUPERSEDED, no push', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Hold');
    const fake = new FakeProvider();
    const { svc } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(out.status).toBe('SKIPPED');
    expect(out.reason).toMatch(/STATUS_SUPERSEDED:Hold/);
    expect(fake.calls).toHaveLength(0);
    expect(prisma.storeOrderMapping.update).not.toHaveBeenCalled();
  });

  it('disconnected store → SKIPPED STORE_NOT_CONNECTED, no push', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Cancelled');
    prisma.store.findUnique.mockResolvedValue({ ...CONNECTED_STORE, status: 'DISCONNECTED' });
    const fake = new FakeProvider();
    const { svc } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(out.status).toBe('SKIPPED');
    expect(out.reason).toMatch(/STORE_NOT_CONNECTED:DISCONNECTED/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('P7 worker — standard retry classification', () => {
  it('transient push failure → RETRY_SCHEDULED with the §8.1 ladder delay', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Cancelled');
    const fake = new FakeProvider();
    fake.injectFailure({
      method: 'pushOrderStatus', times: 1, category: ProviderErrorCategory.TEMPORARY_FAILURE,
    });
    const { svc, runs, queues } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(out.status).toBe('FAILED');
    expect(out.reason).toMatch(/RETRY_SCHEDULED:1:/);
    expect(runs.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PENDING', attemptNo: 1,
    }));
    // Engine-owned retry re-enqueue (BullMQ attempts stay 1).
    expect(queues.enqueue).toHaveBeenCalledWith(
      'store-order-push', 'order-status-push',
      expect.objectContaining({ orderId: 'o1', attemptNo: 1 }),
      expect.stringContaining(':retry:1'),
      expect.objectContaining({ delay: 30_000 }),
    );
    expect(runs.upsertIssue).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.update).not.toHaveBeenCalled();
  });

  it('permanent push failure → DEAD + ORDER_PUSH_DEAD issue, no retry loop', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Cancelled');
    const fake = new FakeProvider();
    fake.injectFailure({
      method: 'pushOrderStatus', times: 99, category: ProviderErrorCategory.INVALID_REQUEST,
    });
    const { svc, runs, queues } = buildPush(prisma, fake);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(out.status).toBe('FAILED');
    expect(out.reason).toMatch(/^DEAD:/);
    expect(runs.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: 'DEAD' }));
    expect(runs.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ORDER_PUSH_DEAD', objectType: 'ORDER',
    }));
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(prisma.storeOrderMapping.update).not.toHaveBeenCalled();
  });

  it('read-back mismatch → exactly one repair push, then classified failure (no silent pass)', async () => {
    const prisma = mockPrisma();
    seedPushable(prisma, 'Cancelled');
    const provider = {
      slug: 'custom',
      declaredCapabilities: { orderStatusUpdate: true, orderStatusUpdateTargets: ['cancelled'] },
      resolveCapabilities: jest.fn().mockResolvedValue({
        orderStatusUpdate: true, orderStatusUpdateTargets: ['cancelled'],
      }),
      pushOrderStatus: jest.fn().mockResolvedValue({ ok: true }),
      // Remote never converges — both reads disagree with the target.
      readOrderStatus: jest.fn().mockResolvedValue({ status: 'processing' }),
    } as any;
    const { svc, runs } = buildPush(prisma, provider);

    const out = await svc.handlePush({ storeId: 's1', orderId: 'o1', ecoStatus: 'Cancelled' });

    expect(provider.pushOrderStatus).toHaveBeenCalledTimes(2); // initial + one repair
    expect(provider.readOrderStatus).toHaveBeenCalledTimes(2);
    expect(out.status).toBe('FAILED');
    expect(prisma.storeOrderMapping.update).not.toHaveBeenCalled();
    expect(runs.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: expect.stringContaining('ORDER_PUSH_VERIFY_FAILED'),
    }));
  });
});
