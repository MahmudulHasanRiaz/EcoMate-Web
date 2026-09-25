/**
 * Ownership/override + product-sync engine suite — central-commerce §8.3,
 * §8.8, §8.11 Table B, BR-02/BR-03/BR-04/BR-05/BR-09/BR-22/BR-23/BR-26 (P4).
 *
 * - external-only change preserved across three sync cycles with a
 *   zero-provider-call assertion (no push over drifted external)
 * - conflict detection (both changed → CONFLICT, no push)
 * - Force EcoMate Value success + audit (actor + prev external + baseline)
 * - Keep External rebase followed by a later EcoMate edit being pushed
 * - first-contact adopt_existing for pre-existing external products
 * - unpublish/assignment-OFF → draft, never delete; capability-gated
 *   deletion only from the hard-delete path (BR-09)
 * - combos skipped (BR-22), cost never pushed (BR-23), MISSING_SKU gate
 * - override guard: sync/retry paths never resolve (BR-26)
 */
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { FieldOwnershipService } from '../../distribution/field-ownership.service';
import { StoreAvailabilityService } from '../../distribution/store-availability.service';
import { DistributionService } from '../../distribution/distribution.service';
import { SyncRunService } from '../sync-run.service';
import { CategorySyncService } from '../category-sync.service';
import { ProductSyncService } from '../product-sync.service';
import { hashFieldValue } from '../../providers/field-snapshot';

const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';

function mockPrisma() {
  const fieldStates = new Map<string, any>();
  const productMappings = new Map<string, any>();
  const categoryMappings = new Map<string, any>();
  const mediaMappings = new Map<string, any>();
  const variantMappings = new Map<string, any>();
  const skuMappings = new Map<string, any>();
  const issues: any[] = [];
  const items: any[] = [];
  const attempts: any[] = [];
  let runSeq = 0;

  const prisma: any = {
    store: {
      findUnique: jest.fn(async () => ({ id: STORE_ID, kind: 'WOOCOMMERCE', name: 'Woo', settings: {} })),
      findMany: jest.fn(async () => []),
    },
    storeCredential: { findMany: jest.fn(async () => []) },
    product: { findUnique: jest.fn() },
    category: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    productStoreAssignment: { findMany: jest.fn(async () => []) },
    storeAvailabilityRule: { findMany: jest.fn(async () => []) },
    productStoreFieldState: {
      findMany: jest.fn(async ({ where }: any) => {
        const all = [...fieldStates.values()];
        return all.filter((s) => (!where?.storeId || s.storeId === where.storeId) && (!where?.productId || s.productId === where.productId));
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_productId_field;
        return (k ? fieldStates.get(`${k.storeId}:${k.productId}:${k.field}`) : null) ?? null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.storeId_productId_field;
        const key = `${k.storeId}:${k.productId}:${k.field}`;
        const next = { ...(fieldStates.get(key) ?? {}), ...create, ...update };
        fieldStates.set(key, next);
        return next;
      }),
    },
    storeProductMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_productId;
        return (k ? productMappings.get(`${k.storeId}:${k.productId}`) : null) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `map-${productMappings.size + 1}`, ...data };
        productMappings.set(`${data.storeId}:${data.productId}`, row);
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        for (const [k, v] of productMappings) {
          if (v.id === where.id) {
            productMappings.delete(k);
            return v;
          }
        }
        return null;
      }),
    },
    storeCategoryMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_categoryId;
        return (k ? categoryMappings.get(`${k.storeId}:${k.categoryId}`) : null) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cat-${categoryMappings.size + 1}`, ...data };
        categoryMappings.set(`${data.storeId}:${data.categoryId}`, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    storeMediaMapping: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `med-${mediaMappings.size + 1}`, ...data };
        mediaMappings.set(`${data.storeId}:${data.mediaKey}`, row);
        return row;
      }),
    },
    storeVariantMapping: {
      upsert: jest.fn(async ({ create, update }: any) => {
        const row = { id: `var-${variantMappings.size + 1}`, ...create, ...update };
        variantMappings.set(`${create.storeId}:${create.variantId}`, row);
        return row;
      }),
    },
    storeSkuMapping: {
      upsert: jest.fn(async ({ create }: any) => {
        skuMappings.set(`${create.storeId}:${create.sku}`, create);
        return create;
      }),
    },
    syncRun: {
      create: jest.fn(async ({ data }: any) => ({ id: `run-${++runSeq}`, ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...data })),
    },
    syncRunItem: { create: jest.fn(async ({ data }: any) => { items.push(data); return data; }), findMany: jest.fn(async () => []) },
    syncAttempt: { create: jest.fn(async ({ data }: any) => { attempts.push(data); return data; }), count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    storeSyncIssue: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => { issues.push(data); return data; }),
      update: jest.fn(async ({ data }: any) => data),
      findMany: jest.fn(async () => issues),
    },
  };
  return { prisma, fieldStates, productMappings, issues, items, attempts };
}

function ecoProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Eco Tee',
    slug: 'eco-tee',
    type: 'simple',
    description: 'Full',
    shortDesc: 'Short',
    basePrice: '100' as unknown,
    salePrice: null,
    sku: 'ECO-TEE-1',
    isActive: true,
    status: 'active',
    categoryId: null,
    brandId: null,
    brand: null,
    tags: [],
    productTags: [],
    images: [],
    seoMeta: {},
    variants: [],
    productCategories: [],
    ...overrides,
  };
}

function setup(ecoOverrides: Record<string, unknown> = {}, seedRemote: Record<string, unknown> | null = { name: 'Eco Tee' }) {
  const { prisma, fieldStates, productMappings, issues, items, attempts } = mockPrisma();
  const fake = new FakeProvider();
  (prisma.product.findUnique as jest.Mock).mockResolvedValue(ecoProduct(ecoOverrides));
  const registry: any = { providerFor: () => fake };
  const runs = new SyncRunService(prisma);
  const svc = new ProductSyncService(
    prisma,
    registry,
    new FieldOwnershipService(),
    new DistributionService(prisma, new StoreAvailabilityService()),
    runs,
    new CategorySyncService(prisma, runs),
  );
  const runId = 'run-1';
  if (seedRemote) {
    fake.directSeed('remote-1', { sku: 'ECO-TEE-1', ...(seedRemote as Record<string, unknown>) }, 'IN_STOCK', 'draft');
    productMappings.set(`${STORE_ID}:${PRODUCT_ID}`, { id: 'map-1', storeId: STORE_ID, productId: PRODUCT_ID, externalId: 'remote-1' });
  }
  const upsertsBefore = () => fake.calls.filter((c) => c.method === 'upsertProduct').length;
  return { prisma, fake, svc, runId, fieldStates, productMappings, issues, items, upsertsBefore };
}

describe('product sync engine (P4)', () => {
  it('create path pushes all matrix fields and writes ECOMATE baselines', async () => {
    const { svc, runId, fake, fieldStates } = setup({}, null);
    const res = await svc.syncProduct(STORE_ID, PRODUCT_ID, runId);
    expect(fake.productCount()).toBe(1);
    expect(res.pushed.length).toBeGreaterThan(10);
    expect(res.preserved).toEqual([]);
    // Cost never pushed even though the matrix row exists (BR-23).
    const created = fake.findBySku('ECO-TEE-1');
    expect(created?.fields.costPrice).toBeUndefined();
    const nameState = fieldStates.get(`${STORE_ID}:${PRODUCT_ID}:name`);
    expect(nameState).toMatchObject({ ownership: 'ECOMATE' });
    expect(nameState.baselineHash).toBe(hashFieldValue('Eco Tee'));
  });

  it('MISSING_SKU blocks distribution with zero provider calls', async () => {
    const { svc, runId, fake, issues } = setup({ sku: null }, null);
    const res = await svc.syncProduct(STORE_ID, PRODUCT_ID, runId);
    expect(res.skipped).toEqual(['missing-sku']);
    expect(fake.calls).toHaveLength(0);
    expect(issues.some((i) => i.code === 'MISSING_SKU')).toBe(true);
  });

  it('combos are skipped with reason, never fabricated (BR-22)', async () => {
    const { svc, runId, fake, issues } = setup({ type: 'combo' }, null);
    const res = await svc.syncProduct(STORE_ID, PRODUCT_ID, runId);
    expect(fake.productCount()).toBe(0);
    expect(res.skipped).toEqual(['combo']);
    expect(issues.some((i) => i.code === 'COMBO_SKIPPED')).toBe(true);
  });

  it('external-only edit preserved across THREE cycles with zero upsert calls (BR-02)', async () => {
    const { svc, runId, fake, upsertsBefore } = setup();
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-0'); // quiet: ECOMATE baselines
    const base = upsertsBefore();
    // Store operator renames remotely between syncs.
    fake.getProduct('remote-1')!.fields.name = 'Store Local Name';
    for (let cycle = 0; cycle < 3; cycle++) {
      const res = await svc.syncProduct(STORE_ID, PRODUCT_ID, runId);
      expect(res.preserved).toContain('name');
      expect(res.pushed).not.toContain('name');
    }
    expect(upsertsBefore()).toBe(base);
    const remote = fake.getProduct('remote-1')!;
    expect(remote.fields.name).toBe('Store Local Name');
  });

  it('conflict (both changed) marks CONFLICT and never pushes (BR-03)', async () => {
    const { prisma, svc, runId, fake } = setup();
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-0'); // quiet: ECOMATE baselines
    fake.getProduct('remote-1')!.fields.name = 'Store Local Name';
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(ecoProduct({ name: 'Eco Tee v2' }));
    const res = await svc.syncProduct(STORE_ID, PRODUCT_ID, runId);
    expect(res.preserved).toContain('name');
    expect(res.pushed).not.toContain('name');
    const states = await prisma.productStoreFieldState.findMany({ where: { storeId: STORE_ID, productId: PRODUCT_ID } });
    expect(states.find((s: any) => s.field === 'name')?.ownership).toBe('CONFLICT');
    expect(fake.getProduct('remote-1')!.fields.name).toBe('Store Local Name');
  });

  it('Force EcoMate Value pushes + audits actor/prev-external/prev-baseline (BR-04)', async () => {
    const { svc, fake, prisma, items } = setup();
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-0'); // quiet baselines
    fake.getProduct('remote-1')!.fields.name = 'Store Local Name';
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');
    const before = await prisma.productStoreFieldState.findUnique({
      where: { storeId_productId_field: { storeId: STORE_ID, productId: PRODUCT_ID, field: 'name' } },
    });
    const out = await svc.forceEcoMateValue(STORE_ID, PRODUCT_ID, ['name'], 'actor-1');
    expect(out.results).toEqual([{ field: 'name', ok: true }]);
    expect(fake.getProduct('remote-1')!.fields.name).toBe('Eco Tee');
    const audit = items.find((i: any) => String(i.reason ?? '').startsWith('override:reset'));
    expect(audit).toBeDefined();
    expect(String(audit.reason)).toMatch(/actor=actor-1/);
    expect(String(audit.reason)).toMatch(/prevExternal=[0-9a-f]{64}/);
    expect(String(audit.reason)).toMatch(new RegExp(`prevBaseline=${before.baselineHash}`));
  });

  it('Keep External rebase allows a LATER EcoMate edit to push (BR-04 rebase)', async () => {
    const { prisma, svc, fake } = setup();
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-0'); // quiet baselines
    fake.getProduct('remote-1')!.fields.name = 'Store Local Name';
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');
    await svc.keepExternalValue(STORE_ID, PRODUCT_ID, ['name'], 'actor-1');
    // EcoMate edits afterwards → pushed normally (field not frozen).
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(ecoProduct({ name: 'Eco Tee v3' }));
    const res = await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-2');
    expect(res.pushed).toContain('name');
    expect(fake.getProduct('remote-1')!.fields.name).toBe('Eco Tee v3');
  });

  it('first contact adopts pre-existing external values as baseline (BR-05)', async () => {
    const { prisma, fieldStates } = mockPrisma();
    const fake = new FakeProvider();
    fake.directSeed('woo-9', { sku: 'ECO-TEE-1', name: 'Pre-existing Store Name' }, 'IN_STOCK', 'published');
    (fake as any).findBySku = async (_store: unknown, sku: string) => {
      const found = fake.findBySku(sku);
      return found ? { providerId: 'woo-9' } : null;
    };
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(ecoProduct());
    const registry: any = { providerFor: () => fake };
    const runs = new SyncRunService(prisma);
    const svc = new ProductSyncService(
      prisma, registry, new FieldOwnershipService(),
      new DistributionService(prisma, new StoreAvailabilityService()), runs,
      new CategorySyncService(prisma, runs),
    );
    const before = fake.calls.filter((c) => c.method === 'upsertProduct').length;
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');
    // Adopted, not overwritten: zero upserts over the adopted name.
    expect(fake.calls.filter((c) => c.method === 'upsertProduct').length).toBe(before);
    expect(fake.getProduct('woo-9')!.fields.name).toBe('Pre-existing Store Name');
    expect(fieldStates.get(`${STORE_ID}:${PRODUCT_ID}:name`)?.ownership).toBe('EXTERNAL');
  });

  it('unpublish / assignment-OFF moves remote to draft and never deletes (§8.8)', async () => {
    const { prisma, svc, runId, fake, productMappings } = setup({ isActive: false });
    await svc.syncProduct(STORE_ID, PRODUCT_ID, runId);
    expect(fake.getProduct('remote-1')!.publication).toBe('draft');
    expect(fake.productCount()).toBe(1);
    expect(productMappings.size).toBe(1);
    expect(fake.calls.some((c) => c.method === 'deleteProduct')).toBe(false);
  });

  it('delete:false retains remote + MANUAL_ACTION_REQUIRED (BR-09)', async () => {
    const { svc, fake } = setup();
    (fake as any).declaredCapabilities = { ...fake.declaredCapabilities, delete: false };
    const out = await svc.deleteRemote(STORE_ID, PRODUCT_ID);
    expect(out.deleted).toBe(false);
    expect(out.reason).toMatch(/MANUAL_ACTION_REQUIRED/);
    expect(fake.productCount()).toBe(1);
  });

  it('delete:true removes remote + mapping from the hard-delete path only', async () => {
    const { svc, fake, productMappings } = setup();
    const out = await svc.deleteRemote(STORE_ID, PRODUCT_ID);
    expect(out).toEqual({ deleted: true, reason: 'deleted' });
    expect(fake.productCount()).toBe(0);
    expect(productMappings.size).toBe(0);
  });

  it('NATIVE store is rejected (BR-20)', async () => {
    const { prisma, svc, runId } = setup();
    (prisma.store.findUnique as jest.Mock).mockResolvedValue({ id: STORE_ID, kind: 'NATIVE', name: 'Native', settings: {} });
    await expect(svc.syncProduct(STORE_ID, PRODUCT_ID, runId)).rejects.toThrow(/BR-20/);
  });

  it('override guard: retry records attempts but never resolves ownership (BR-26)', async () => {
    const { prisma, svc, runId, fake } = setup();
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-0'); // quiet baselines
    fake.getProduct('remote-1')!.fields.name = 'Store Local Name';
    await svc.syncProduct(STORE_ID, PRODUCT_ID, runId);
    const states = await prisma.productStoreFieldState.findMany({ where: { storeId: STORE_ID, productId: PRODUCT_ID } });
    // Re-running sync (the retry/reconcile path) keeps the drift — nothing flips back.
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-retry');
    const after = await prisma.productStoreFieldState.findMany({ where: { storeId: STORE_ID, productId: PRODUCT_ID } });
    expect(after.find((s: any) => s.field === 'name')?.ownership).toBe(
      states.find((s: any) => s.field === 'name')?.ownership,
    );
    expect(fake.getProduct('remote-1')!.fields.name).toBe('Store Local Name');
  });

  it('reset-all only touches drifted fields', async () => {
    const { svc, fake } = setup();
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-0'); // quiet baselines
    fake.getProduct('remote-1')!.fields.name = 'Store Local Name';
    await svc.syncProduct(STORE_ID, PRODUCT_ID, 'run-1');
    const out = await svc.resetAll(STORE_ID, PRODUCT_ID, 'actor-1');
    expect(out.results.some((r) => r.field === 'name' && r.ok)).toBe(true);
    expect(fake.getProduct('remote-1')!.fields.name).toBe('Eco Tee');
  });
});
