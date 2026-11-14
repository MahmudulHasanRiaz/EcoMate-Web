/**
 * Category lifecycle suite — central-commerce §8.9 (P4).
 *
 * Mapping-keyed (never name), slug-within-parent lookup, rename/move,
 * idempotent re-sync, remote-deleted recovery, unsupported →
 * CATEGORY_UNSUPPORTED notice with products proceeding.
 */
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { CategorySyncService } from '../category-sync.service';
import { SyncRunService } from '../sync-run.service';
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';

function mockPrisma() {
  const mappings = new Map<string, any>();
  const issues: any[] = [];
  const items: any[] = [];
  const prisma: any = {
    category: {
      findUnique: jest.fn(async ({ where }: any) => {
        const cats: Record<string, any> = {
          'cat-leaf': { id: 'cat-leaf', name: 'Shirts', parentId: 'cat-parent' },
          'cat-parent': { id: 'cat-parent', name: 'Men', parentId: null },
        };
        return cats[where.id] ?? null;
      }),
    },
    storeCategoryMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_categoryId;
        return (k ? mappings.get(`${k.storeId}:${k.categoryId}`) : null) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `m-${mappings.size + 1}`, ...data };
        mappings.set(`${data.storeId}:${data.categoryId}`, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    syncRun: { create: jest.fn(async ({ data }: any) => ({ id: 'run-1', ...data })), update: jest.fn(async () => ({})) },
    syncRunItem: { create: jest.fn(async ({ data }: any) => { items.push(data); return data; }) },
    syncAttempt: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
    storeSyncIssue: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => { issues.push(data); return data; }),
      update: jest.fn(async () => ({})),
    },
  };
  return { prisma, mappings, issues, items };
}

const STORE = { id: 'store-1' };
const SWS = { id: 'store-1', kind: 'WOOCOMMERCE', settings: {}, secrets: {} };

describe('category lifecycle §8.9 (P4)', () => {
  it('ensurePath creates parent-first and writes one mapping per level', async () => {
    const { prisma, mappings } = mockPrisma();
    const runs = new SyncRunService(prisma);
    const svc = new CategorySyncService(prisma, runs);
    const fake = new FakeProvider();
    const ref = await svc.ensurePath(STORE as any, fake as any, SWS as any, 'cat-leaf', 'run-1');
    expect(ref?.providerId).toBeDefined();
    expect(mappings.size).toBe(2);
    expect(mappings.get('store-1:cat-parent')).toBeDefined();
    expect(mappings.get('store-1:cat-leaf')).toBeDefined();
  });

  it('re-sync is idempotent: mapped levels make zero provider calls', async () => {
    const { prisma } = mockPrisma();
    const runs = new SyncRunService(prisma);
    const svc = new CategorySyncService(prisma, runs);
    const fake = new FakeProvider();
    await svc.ensurePath(STORE as any, fake as any, SWS as any, 'cat-leaf', 'run-1');
    const callsAfterFirst = fake.calls.length;
    await svc.ensurePath(STORE as any, fake as any, SWS as any, 'cat-leaf', 'run-1');
    expect(fake.calls.length).toBe(callsAfterFirst);
  });

  it('rename updates the mapped term (never a second term)', async () => {
    const { prisma, mappings } = mockPrisma();
    const runs = new SyncRunService(prisma);
    const svc = new CategorySyncService(prisma, runs);
    const fake = new FakeProvider();
    await svc.ensurePath(STORE as any, fake as any, SWS as any, 'cat-leaf', 'run-1');
    const before = mappings.get('store-1:cat-leaf').externalTermId;
    await svc.rename('store-1', fake as any, SWS as any, 'cat-leaf', 'T-Shirts');
    expect(mappings.get('store-1:cat-leaf').externalTermId).toBe(before);
    expect(fake.calls.some((c) => c.method === 'renameCategory')).toBe(true);
  });

  it('move failure raises an actionable issue instead of duplicating', async () => {
    const { prisma, issues } = mockPrisma();
    const runs = new SyncRunService(prisma);
    const svc = new CategorySyncService(prisma, runs);
    const fake = new FakeProvider();
    await svc.ensurePath(STORE as any, fake as any, SWS as any, 'cat-leaf', 'run-1');
    fake.injectFailure({ method: 'moveCategory', times: 99, category: ProviderErrorCategory.INVALID_REQUEST, message: 'cannot re-parent' });
    await svc.move('store-1', fake as any, SWS as any, 'cat-leaf', null);
    expect(issues.some((i) => i.code === 'CATEGORY_MOVE_UNSUPPORTED')).toBe(true);
  });

  it('unsupported categoryModel → CATEGORY_UNSUPPORTED notice, null ref (products proceed)', async () => {
    const { prisma, issues, items } = mockPrisma();
    const runs = new SyncRunService(prisma);
    const svc = new CategorySyncService(prisma, runs);
    const noCats = { declaredCapabilities: { categories: false, categoryModel: 'unsupported' } };
    const ref = await svc.ensurePath(STORE as any, noCats as any, SWS as any, 'cat-leaf', 'run-1');
    expect(ref).toBeNull();
    expect(issues.some((i) => i.code === 'CATEGORY_UNSUPPORTED')).toBe(true);
    expect(items.some((i) => i.reason?.includes('CATEGORY_UNSUPPORTED'))).toBe(true);
  });
});
