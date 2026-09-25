/**
 * Stock-status sync suite — central-commerce §8.4, BR-06/BR-07/BR-08,
 * §13 stock suite, P5 row.
 *
 * Covers: threshold matrix (0 / below / above), per-store override,
 * race case (stale event never resurrects state), zero verified on every
 * assigned store, above-threshold silence, unsupported-fidelity zero writes
 * + STOCK_DRIFT_MONITOR_ONLY, read-back-or-repair-then-issue, combos never
 * pushed, NATIVE guard, notify coalescing/debounce/non-propagation,
 * daily-audit repeatable (0 3 * * * Asia/Dhaka, paged/bounded/resumable,
 * SyncRun STOCK), status-only (no quantity ever), never-call-provider-
 * from-mutation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { SyncRunService } from '../sync-run.service';
import {
  STOCK_AUDIT_CONCURRENCY,
  STOCK_AUDIT_CRON,
  STOCK_AUDIT_PAGE_SIZE,
  STOCK_AUDIT_TZ,
  STOCK_DEBOUNCE_MS,
  STOCK_THRESHOLD_DEFAULT,
  StockStatusSyncService,
  desiredFromQty,
  isStale,
  thresholdFor,
  versionFor,
} from '../stock-status-sync.service';

const STORE_ID = 'store-1';
const STORE_2 = 'store-2';
const PRODUCT_ID = 'prod-1';
const VARIANT_ID = 'var-1';
const RUN_ID = 'run-1';

const ENV_KEYS = [
  'THIRD_PARTY_STORES_ENABLED',
  'store_sync_enabled',
  'store_stock_sync_enabled',
  'store_stock_audit_enabled',
] as const;
let savedEnv: Record<string, string | undefined> = {};

function flagsOn() {
  for (const k of ENV_KEYS) process.env[k] = 'true';
}
function flagsOff() {
  for (const k of ENV_KEYS) delete process.env[k];
}

interface MockCtx {
  prisma: any;
  productMappings: Map<string, any>;
  variantMappings: Map<string, any>;
  issues: any[];
  items: any[];
  attempts: any[];
  runsCreated: any[];
  runsFinished: any[];
  setProduct: (p: any) => void;
  setMapping: (m: any | null) => void;
  setVariantMapping: (m: any | null) => void;
}

function mockPrisma(): MockCtx {
  const productMappings = new Map<string, any>();
  const variantMappings = new Map<string, any>();
  const issues: any[] = [];
  const items: any[] = [];
  const attempts: any[] = [];
  const runsCreated: any[] = [];
  const runsFinished: any[] = [];
  let product: any = null;
  let stores: any[] = [
    { id: STORE_ID, kind: 'WOOCOMMERCE', settings: {}, status: 'CONNECTED' },
  ];
  let assignments: any[] = [{ storeId: STORE_ID, productId: PRODUCT_ID }];

  const prisma: any = {
    __setStores: (s: any[]) => {
      stores = s;
    },
    __setAssignments: (a: any[]) => {
      assignments = a;
    },
    store: {
      findUnique: jest.fn(async ({ where }: any) => {
        const hit = stores.find((s) => s.id === where.id);
        return hit ?? null;
      }),
      // Emulates the notify/audit where-clauses (kind NOT NATIVE,
      // status CONNECTED, id IN …): the service relies on the DB filter.
      findMany: jest.fn(async (args: any = {}) => {
        const where = args?.where ?? {};
        return stores.filter((s) => {
          if (where?.id?.in && !where.id.in.includes(s.id)) return false;
          if (where?.kind?.not && s.kind === where.kind.not) return false;
          if (where?.status && s.status !== where.status) return false;
          return true;
        });
      }),
    },
    productStoreAssignment: {
      findMany: jest.fn(async ({ where }: any = {}) => {
        if (where?.storeId) return assignments.filter((a) => a.storeId === where.storeId);
        return assignments;
      }),
    },
    product: {
      findUnique: jest.fn(async () => product),
    },
    productVariant: {
      findUnique: jest.fn(async ({ where }: any) => {
        const vs = product?.variants ?? [];
        return vs.find((v: any) => v.id === where.id) ?? null;
      }),
    },
    storeProductMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_productId;
        return (k ? productMappings.get(`${k.storeId}:${k.productId}`) : null) ?? null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = productMappings.get(`${where.storeId}:${where.productId}`);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
    },
    storeVariantMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_variantId;
        return (k ? variantMappings.get(`${k.storeId}:${k.variantId}`) : null) ?? null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = variantMappings.get(`${where.storeId}:${where.variantId}`);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
    },
    managedStockLedger: {
      findFirst: jest.fn(async () => null),
    },
    physicalInventory: {
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({ _max: { updatedAt: null } })),
    },
    comboItem: {
      findMany: jest.fn(async () => []),
    },
    syncRun: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `run-${runsCreated.length + 1}`, ...data };
        runsCreated.push(row);
        return row;
      }),
      update: jest.fn(async ({ data }: any) => {
        runsFinished.push(data);
        return data;
      }),
    },
    syncRunItem: {
      create: jest.fn(async ({ data }: any) => {
        items.push(data);
        return data;
      }),
      findMany: jest.fn(async () => []),
    },
    syncAttempt: {
      create: jest.fn(async ({ data }: any) => {
        attempts.push(data);
        return data;
      }),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    storeSyncIssue: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        issues.push(data);
        return data;
      }),
      update: jest.fn(async ({ data }: any) => data),
      findMany: jest.fn(async () => issues),
    },
  };
  return {
    prisma,
    productMappings,
    variantMappings,
    issues,
    items,
    attempts,
    runsCreated,
    runsFinished,
    setProduct: (p: any) => {
      product = p;
    },
    setMapping: (m: any | null) => {
      if (m) productMappings.set(`${m.storeId}:${m.productId}`, m);
      else productMappings.delete(`${STORE_ID}:${PRODUCT_ID}`);
    },
    setVariantMapping: (m: any | null) => {
      if (m) variantMappings.set(`${m.storeId}:${m.variantId}`, m);
      else variantMappings.delete(`${STORE_ID}:${VARIANT_ID}`);
    },
  };
}

function simpleProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Stock Tee',
    status: 'active',
    isActive: true,
    type: 'simple',
    availabilityMode: 'MANAGED_STOCK',
    managedStockQuantity: 10,
    reservedStock: 0,
    lowStockQty: null,
    updatedAt: new Date('2026-09-20T00:00:00Z'),
    variants: [],
    ...overrides,
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const ctx = mockPrisma();
  ctx.setProduct(simpleProduct(overrides));
  const fake = new FakeProvider();
  const registry: any = { providerFor: () => fake };
  const runs = new SyncRunService(ctx.prisma);
  const enqueued: any[] = [];
  const queues: any = {
    enqueue: jest.fn(async (...args: any[]) => {
      enqueued.push(args);
    }),
    serializeStore: async (_id: string, work: () => Promise<any>) => work(),
  };
  const stockQueue: any = {
    getRepeatableJobs: jest.fn(async () => []),
    add: jest.fn(async () => undefined),
    removeRepeatableByKey: jest.fn(async () => undefined),
  };
  const svc = new StockStatusSyncService(
    ctx.prisma,
    registry,
    runs,
    queues,
    stockQueue,
    undefined,
  );
  return { ...ctx, fake, registry, runs, queues, enqueued, stockQueue, svc };
}

function seedRemote(ctx: { fake: FakeProvider }, state: 'IN_STOCK' | 'OUT_OF_STOCK' = 'IN_STOCK') {
  ctx.fake.directSeed('remote-1', { sku: 'STOCK-TEE-1' }, state, 'published');
}

function mapped(ctx: MockCtx, version: string | null = null) {
  ctx.setMapping({
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    externalId: 'remote-1',
    lastEvaluatedVersion: version,
  });
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
  }
  flagsOn();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.restoreAllMocks();
});

describe('stock-status pure rules (BR-07)', () => {
  it('threshold precedence: store override > product lowStockQty > default 5', () => {
    expect(thresholdFor({ stockLowThreshold: 10 }, 3)).toBe(10);
    expect(thresholdFor({ stockLowThreshold: '7' }, 3)).toBe(7);
    expect(thresholdFor({}, 3)).toBe(3);
    expect(thresholdFor(null, null)).toBe(STOCK_THRESHOLD_DEFAULT);
    expect(thresholdFor({}, null)).toBe(5);
    // Non-positive / garbage overrides never win.
    expect(thresholdFor({ stockLowThreshold: 0 }, 3)).toBe(3);
    expect(thresholdFor({ stockLowThreshold: -2 }, null)).toBe(5);
    expect(thresholdFor({ stockLowThreshold: 'junk' }, 4)).toBe(4);
  });

  it('desiredFromQty matrix: 0 → zero/OUT, below → IN, at/above → IN/above', () => {
    expect(desiredFromQty(0, 5)).toEqual({ state: 'OUT_OF_STOCK', path: 'zero' });
    expect(desiredFromQty(-4, 5)).toEqual({ state: 'OUT_OF_STOCK', path: 'zero' });
    expect(desiredFromQty(1, 5)).toEqual({ state: 'IN_STOCK', path: 'below' });
    expect(desiredFromQty(4, 5)).toEqual({ state: 'IN_STOCK', path: 'below' });
    expect(desiredFromQty(5, 5)).toEqual({ state: 'IN_STOCK', path: 'above' });
    expect(desiredFromQty(50, 5)).toEqual({ state: 'IN_STOCK', path: 'above' });
  });

  it('monotonic version guard: equal-or-older never pushes', () => {
    const older = versionFor('2026-09-20T00:00:00Z', null);
    const newer = versionFor('2026-09-21T00:00:00Z', null);
    expect(newer > older).toBe(true);
    expect(isStale(newer, older)).toBe(false);
    expect(isStale(older, newer)).toBe(true);
    // Equal counts as stale: a replayed event must not re-push.
    expect(isStale(newer, newer)).toBe(true);
    expect(isStale(older, null)).toBe(false);
    expect(isStale(older, undefined)).toBe(false);
  });

  it('schedule constants: daily 0 3 * * * Asia/Dhaka, 1500ms debounce', () => {
    expect(STOCK_AUDIT_CRON).toBe('0 3 * * *');
    expect(STOCK_AUDIT_TZ).toBe('Asia/Dhaka');
    expect(STOCK_DEBOUNCE_MS).toBe(1500);
    expect(STOCK_AUDIT_PAGE_SIZE).toBeGreaterThan(0);
    expect(STOCK_AUDIT_CONCURRENCY).toBeGreaterThan(0);
  });
});

describe('notifyStockChanged (§8.4 post-commit, R-2)', () => {
  it('enqueues coalesced jobId per assigned store with 1500ms debounce, never touches the provider', async () => {
    const s = setup();
    seedRemote(s, 'IN_STOCK');
    mapped(s);
    await s.svc.notifyStockChanged(PRODUCT_ID, null, 'test');
    expect(s.queues.enqueue).toHaveBeenCalledTimes(1);
    expect(s.queues.enqueue).toHaveBeenCalledWith(
      'store-stock-sync',
      'stock-change',
      { storeId: STORE_ID, productId: PRODUCT_ID, variantId: null, reason: 'test' },
      `stock:${STORE_ID}:${PRODUCT_ID}:-`,
      { delay: 1500 },
    );
    expect(s.fake.calls).toHaveLength(0);
  });

  it('variant notify coalesces on product+variant; two stores fan out twice', async () => {
    const s = setup();
    s.prisma.__setStores([
      { id: STORE_ID, kind: 'WOOCOMMERCE', settings: {}, status: 'CONNECTED' },
      { id: STORE_2, kind: 'WOOCOMMERCE', settings: {}, status: 'CONNECTED' },
    ]);
    s.prisma.__setAssignments([
      { storeId: STORE_ID, productId: PRODUCT_ID },
      { storeId: STORE_2, productId: PRODUCT_ID },
    ]);
    await s.svc.notifyStockChanged(PRODUCT_ID, VARIANT_ID, 'variant-test');
    expect(s.queues.enqueue).toHaveBeenCalledTimes(2);
    const jobIds = (s.queues.enqueue as jest.Mock).mock.calls.map((c) => c[3]);
    expect(jobIds).toContain(`stock:${STORE_ID}:${PRODUCT_ID}:${VARIANT_ID}`);
    expect(jobIds).toContain(`stock:${STORE_2}:${PRODUCT_ID}:${VARIANT_ID}`);
    for (const c of (s.queues.enqueue as jest.Mock).mock.calls) {
      expect(c[4]).toEqual({ delay: 1500 });
    }
    expect(s.fake.calls).toHaveLength(0);
  });

  it('never propagates: a DB failure resolves silently (hot path unaffected)', async () => {
    const s = setup();
    (s.prisma.productStoreAssignment.findMany as jest.Mock).mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(s.svc.notifyStockChanged(PRODUCT_ID, null, 'boom')).resolves.toBeUndefined();
    expect(s.queues.enqueue).not.toHaveBeenCalled();
  });

  it('flag off → zero enqueues; NATIVE/disconnected stores skipped', async () => {
    const s = setup();
    flagsOff();
    await s.svc.notifyStockChanged(PRODUCT_ID, null, 'flag-off');
    expect(s.queues.enqueue).not.toHaveBeenCalled();
    flagsOn();
    s.prisma.__setStores([
      { id: 'native-1', kind: 'NATIVE', settings: {}, status: 'CONNECTED' },
      { id: 'disc-1', kind: 'WOOCOMMERCE', settings: {}, status: 'DISCONNECTED' },
    ]);
    s.prisma.__setAssignments([
      { storeId: 'native-1', productId: PRODUCT_ID },
      { storeId: 'disc-1', productId: PRODUCT_ID },
    ]);
    await s.svc.notifyStockChanged(PRODUCT_ID, null, 'filtered');
    expect(s.queues.enqueue).not.toHaveBeenCalled();
  });

  it('no provider call happens inside any mutation writer (R-2 static guard)', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const writers = [
      'import/import.service.ts',
      'products/products.service.ts',
      'inventory/inventory.service.ts',
      'inventory/physical-inventory.controller.ts',
      'stock/stock.service.ts',
    ];
    for (const w of writers) {
      const src = fs.readFileSync(path.join(root, w), 'utf8');
      expect(src).toContain('notifyStockChanged');
      expect(src).not.toContain('publishStockState');
      expect(src).not.toContain('readStockState');
      expect(src).not.toContain('providerFor');
    }
  });
});

describe('threshold paths (BR-07, faithful store)', () => {
  it('qty=0 → forced OUT_OF_STOCK push + read-back verify on the assigned store', async () => {
    const s = setup({ managedStockQuantity: 0, reservedStock: 0 });
    seedRemote(s, 'IN_STOCK');
    mapped(s);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: true });
    expect(s.fake.getProduct('remote-1')?.stockState).toBe('OUT_OF_STOCK');
    expect(
      s.fake.calls.filter((c) => c.method === 'publishStockState'),
    ).toHaveLength(1);
    expect(s.items.some((i) => String(i.reason).includes('PUSH_VERIFIED'))).toBe(true);
  });

  it('0<qty<threshold → status recheck/push per change', async () => {
    const s = setup({ managedStockQuantity: 2, reservedStock: 0 });
    seedRemote(s, 'OUT_OF_STOCK');
    mapped(s);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: true });
    expect(s.fake.getProduct('remote-1')?.stockState).toBe('IN_STOCK');
  });

  it('already in sync below threshold → no write', async () => {
    const s = setup({ managedStockQuantity: 2, reservedStock: 0 });
    seedRemote(s, 'IN_STOCK');
    mapped(s);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: false, reason: 'IN_SYNC' });
    expect(s.fake.calls.filter((c) => c.method === 'publishStockState')).toHaveLength(0);
  });

  it('qty>=threshold → NO per-change provider push (daily audit owns it)', async () => {
    const s = setup({ managedStockQuantity: 50, reservedStock: 0 });
    seedRemote(s, 'OUT_OF_STOCK');
    mapped(s);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SKIPPED', pushed: false, reason: 'ABOVE_THRESHOLD' });
    expect(s.fake.calls.filter((c) => c.method === 'publishStockState')).toHaveLength(0);
    // …but the audit DOES repair the same drift.
    const auditOut = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: true });
    expect(auditOut[0]).toMatchObject({ status: 'SUCCESS', pushed: true });
    expect(s.fake.getProduct('remote-1')?.stockState).toBe('IN_STOCK');
  });

  it('per-store threshold override changes the path (qty 7: above@5, below@10)', async () => {
    const s = setup({ managedStockQuantity: 7, reservedStock: 0 });
    s.prisma.__setStores([
      { id: STORE_ID, kind: 'WOOCOMMERCE', settings: { stockLowThreshold: 10 }, status: 'CONNECTED' },
    ]);
    seedRemote(s, 'OUT_OF_STOCK');
    mapped(s);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    // 7 < 10 → below-threshold push, where the default 5 would have skipped.
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: true });
  });
});

describe('race safety (§8.4 monotonic guard)', () => {
  it('a stale event can never resurrect IN_STOCK over a newer OUT_OF_STOCK', async () => {
    const s = setup({ managedStockQuantity: 3, reservedStock: 0 });
    seedRemote(s, 'OUT_OF_STOCK');
    // A newer evaluation already landed (max version); this event is older.
    mapped(s, '999999999999999:999999999999999');
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SKIPPED', pushed: false, reason: 'STALE_EVENT' });
    expect(s.fake.calls.filter((c) => c.method === 'publishStockState')).toHaveLength(0);
    // Remote truth untouched by the stale event.
    expect(s.fake.getProduct('remote-1')?.stockState).toBe('OUT_OF_STOCK');
  });

  it('a fresh event after the recorded version pushes normally', async () => {
    const s = setup({ managedStockQuantity: 0, reservedStock: 0 });
    seedRemote(s, 'IN_STOCK');
    mapped(s, '000000000000001:000000000000000');
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: true });
    expect(s.fake.getProduct('remote-1')?.stockState).toBe('OUT_OF_STOCK');
  });
});

describe('fidelity gate (BR-06/BR-08)', () => {
  function unsupportedSetup() {
    const s = setup({ managedStockQuantity: 0, reservedStock: 0 });
    const publish = jest.fn(async () => ({ ok: true }));
    const read = jest.fn(async () => 'IN_STOCK' as const);
    const provider: any = {
      slug: 'shopify',
      declaredCapabilities: { stockStatusFidelity: 'unsupported' },
      resolveCapabilities: async () => ({ stockStatusFidelity: 'unsupported' }),
      readStockState: read,
      publishStockState: publish,
    };
    s.registry.providerFor = () => provider;
    mapped(s);
    return { ...s, publish, read };
  }

  it('unsupported per-change path: monitor-only, ZERO writes, zero reads', async () => {
    const s = unsupportedSetup();
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SKIPPED', pushed: false, reason: 'UNSUPPORTED_FIDELITY' });
    expect(s.publish).not.toHaveBeenCalled();
    expect(s.read).not.toHaveBeenCalled();
  });

  it('unsupported audit: drift raises STOCK_DRIFT_MONITOR_ONLY with zero writes', async () => {
    const s = unsupportedSetup();
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: true });
    expect(out[0]).toMatchObject({ status: 'FAILED', pushed: false, reason: 'STOCK_DRIFT_MONITOR_ONLY' });
    expect(s.publish).not.toHaveBeenCalled();
    expect(s.read).toHaveBeenCalledTimes(1);
    expect(s.issues.some((i) => i.code === 'STOCK_DRIFT_MONITOR_ONLY')).toBe(true);
  });

  it('unsupported audit: matching remote is IN_SYNC_MONITORED, still zero writes', async () => {
    const s = unsupportedSetup();
    (s.read as jest.Mock).mockResolvedValueOnce('OUT_OF_STOCK');
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: true });
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: false, reason: 'IN_SYNC_MONITORED' });
    expect(s.publish).not.toHaveBeenCalled();
  });

  it('status-only: the push carries (ref, state) and NEVER a quantity/sentinel (BR-06)', async () => {
    const s = setup({ managedStockQuantity: 0, reservedStock: 0 });
    seedRemote(s, 'IN_STOCK');
    mapped(s);
    await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    const pushes = s.fake.calls.filter((c) => c.method === 'publishStockState');
    expect(pushes).toHaveLength(1);
    const detail = pushes[0]!.detail as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(['ref', 'state']);
    expect(detail.state).toBe('OUT_OF_STOCK');
    expect(JSON.stringify(detail)).not.toMatch(/qty|quantity|sentinel|placeholder/i);
  });
});

describe('verification: read-back-or-repair-then-issue', () => {
  function flakySetup(readScript: Array<'IN_STOCK' | 'OUT_OF_STOCK'>) {
    const s = setup({ managedStockQuantity: 0, reservedStock: 0 });
    const reads: string[] = [];
    let n = 0;
    const provider: any = {
      slug: 'woocommerce',
      declaredCapabilities: { stockStatusFidelity: 'faithful' },
      resolveCapabilities: async () => ({ stockStatusFidelity: 'faithful' }),
      readStockState: jest.fn(async () => {
        const v = readScript[Math.min(n++, readScript.length - 1)];
        reads.push(v!);
        return v;
      }),
      publishStockState: jest.fn(async () => ({ ok: true })),
    };
    s.registry.providerFor = () => provider;
    mapped(s);
    return { ...s, provider, reads };
  }

  it('mismatch then match → exactly one repair push (REPAIRED_AFTER_RETRY)', async () => {
    const s = flakySetup(['IN_STOCK', 'OUT_OF_STOCK']);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: true, reason: 'REPAIRED_AFTER_RETRY' });
    expect(s.provider.publishStockState).toHaveBeenCalledTimes(2);
    expect(s.issues.some((i) => i.code === 'STOCK_VERIFY_FAILED')).toBe(false);
  });

  it('mismatch after repair → STOCK_VERIFY_FAILED issue', async () => {
    const s = flakySetup(['IN_STOCK', 'IN_STOCK']);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'FAILED', pushed: true, reason: 'STOCK_VERIFY_FAILED' });
    expect(s.provider.publishStockState).toHaveBeenCalledTimes(2);
    expect(s.issues.some((i) => i.code === 'STOCK_VERIFY_FAILED')).toBe(true);
  });
});

describe('combos + isolation (BR-22/BR-20)', () => {
  it('combos resolve min(child) for the trail and are NEVER pushed', async () => {
    const s = setup({ type: 'combo' });
    (s.prisma.comboItem.findMany as jest.Mock).mockResolvedValue([
      { variant: null, product: { managedStockQuantity: 5, reservedStock: 0 } },
      { variant: null, product: { managedStockQuantity: 0, reservedStock: 0 } },
    ]);
    seedRemote(s, 'IN_STOCK');
    mapped(s);
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, null, RUN_ID, { audit: true });
    expect(out[0]).toMatchObject({ status: 'SKIPPED', pushed: false, reason: 'COMBO_SKIPPED' });
    expect(s.fake.calls.filter((c) => c.method === 'publishStockState')).toHaveLength(0);
    expect(s.items.some((i) => String(i.reason).includes('min child 0'))).toBe(true);
  });

  it('NATIVE is never a sync target (throwing guard, BR-20)', async () => {
    const s = setup({ managedStockQuantity: 0 });
    s.prisma.__setStores([
      { id: 'native-1', kind: 'NATIVE', settings: {}, status: 'CONNECTED' },
    ]);
    seedRemote(s, 'IN_STOCK');
    const out = await s.svc.evaluateProduct('native-1', PRODUCT_ID, null, RUN_ID, { audit: true });
    expect(out[0]).toMatchObject({ status: 'SKIPPED', pushed: false, reason: 'NATIVE_REJECTED' });
    expect(s.fake.calls).toHaveLength(0);
  });

  it('variant zero stock writes the variation ref, never the parent product', async () => {
    const s = setup({
      type: 'variable',
      managedStockQuantity: 0,
      variants: [
        {
          id: VARIANT_ID,
          productId: PRODUCT_ID,
          managedStockQuantity: 0,
          reservedStock: 0,
          isActive: true,
          updatedAt: new Date('2026-09-20T00:00:00Z'),
        },
      ],
    });
    s.fake.directSeed('remote-parent', { sku: 'VAR-PARENT' }, 'IN_STOCK', 'published', [
      { sku: 'VAR-1' } as any,
    ]);
    const parent = s.fake.getProduct('remote-parent') as any;
    let variantProviderId = '';
    for (const slot of parent.variants.values()) {
      variantProviderId = slot.ref.providerId;
    }
    s.setMapping({ storeId: STORE_ID, productId: PRODUCT_ID, externalId: 'remote-parent', lastEvaluatedVersion: null });
    s.setVariantMapping({
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      externalId: variantProviderId,
      lastEvaluatedVersion: null,
    });
    const out = await s.svc.evaluateProduct(STORE_ID, PRODUCT_ID, VARIANT_ID, RUN_ID, { audit: false });
    expect(out[0]).toMatchObject({ status: 'SUCCESS', pushed: true });
    expect(s.fake.calls.filter((c) => c.method === 'publishVariantStockState')).toHaveLength(1);
    expect(s.fake.calls.filter((c) => c.method === 'publishStockState')).toHaveLength(0);
  });
});

describe('daily audit (BullMQ repeatable, SyncRun STOCK)', () => {
  it('registers the 0 3 * * * Asia/Dhaka repeatable; flag-off removes it', async () => {
    const s = setup();
    await s.svc.onModuleInit();
    expect(s.stockQueue.add).toHaveBeenCalledWith(
      'stock-audit',
      {},
      expect.objectContaining({
        repeat: { pattern: '0 3 * * *', tz: 'Asia/Dhaka' },
      }),
    );
    (s.stockQueue.getRepeatableJobs as jest.Mock).mockResolvedValue([
      { name: 'stock-audit', key: 'k1' },
    ]);
    flagsOff();
    await s.svc.onModuleInit();
    expect(s.stockQueue.removeRepeatableByKey).toHaveBeenCalledWith('k1');
  });

  it('paged audit repairs drift and writes exactly one SyncRun(STOCK)', async () => {
    const s = setup({ managedStockQuantity: 0, reservedStock: 0 });
    seedRemote(s, 'IN_STOCK');
    mapped(s);
    (s.prisma.productStoreAssignment.findMany as jest.Mock)
      .mockResolvedValueOnce([{ productId: PRODUCT_ID }])
      .mockResolvedValue([]);
    const summary = await s.svc.runAudit();
    expect(summary).toMatchObject({ stores: 1, evaluated: 1, pushed: 1, failed: 0 });
    expect(s.fake.getProduct('remote-1')?.stockState).toBe('OUT_OF_STOCK');
    expect(s.runsCreated).toHaveLength(1);
    expect(s.runsCreated[0]).toMatchObject({ scope: 'STOCK', triggerType: 'SCHEDULED' });
    expect(s.runsFinished).toHaveLength(1);
  });

  it('cursor resume skips already-audited stores', async () => {
    const s = setup({ managedStockQuantity: 0, reservedStock: 0 });
    s.prisma.__setStores([
      { id: 's-a', kind: 'WOOCOMMERCE', settings: {}, status: 'CONNECTED', autoSyncEnabled: true },
      { id: STORE_ID, kind: 'WOOCOMMERCE', settings: {}, status: 'CONNECTED', autoSyncEnabled: true },
    ]);
    seedRemote(s, 'IN_STOCK');
    mapped(s);
    (s.prisma.productStoreAssignment.findMany as jest.Mock).mockResolvedValue([]);
    const summary = await s.svc.runAudit({ cursor: { storeId: STORE_ID } });
    expect(summary.stores).toBe(1);
    const storeIds = (s.prisma.store.findMany as jest.Mock).mock.calls.length;
    expect(storeIds).toBeGreaterThanOrEqual(1);
  });

  it('P5 migration is additive-only (nullable column, no drops)', () => {
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'prisma',
        'migrations',
        '20260925170000_p5_stock_variant_version',
        'migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('lastEvaluatedVersion');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
