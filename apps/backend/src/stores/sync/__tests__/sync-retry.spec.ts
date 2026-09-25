/**
 * Retry center suite — central-commerce P11 (§11 Failed & Retry).
 *
 * - `isAttemptEligible` pure predicate (mirrored by the admin UI gating).
 * - retry-by-ids / retry-all only enqueue eligible rows (BR-21: HTTP
 *   enqueues, never executes inline).
 * - ignore-with-note audits SKIPPED + note (BR-26: no resolution).
 * - real-failure retry without duplication, proven with FakeProvider:
 *   a transient failure followed by a retry leaves exactly ONE remote
 *   product (idempotent SKU-keyed upsert — the same ref is reused).
 */
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import { SyncRetryService, isAttemptEligible } from '../sync-retry.service';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const past = new Date(NOW.getTime() - 60_000);
const future = new Date(NOW.getTime() + 3_600_000);

describe('isAttemptEligible (P11)', () => {
  it('PENDING/FAILED with no schedule or a due schedule are eligible', () => {
    expect(isAttemptEligible({ status: 'PENDING' }, NOW)).toBe(true);
    expect(isAttemptEligible({ status: 'FAILED' }, NOW)).toBe(true);
    expect(isAttemptEligible({ status: 'PENDING', nextRetryAt: past }, NOW)).toBe(true);
    expect(isAttemptEligible({ status: 'FAILED', nextRetryAt: past }, NOW)).toBe(true);
  });

  it('future-scheduled rows wait; terminal rows never requeue via all-eligible', () => {
    expect(isAttemptEligible({ status: 'PENDING', nextRetryAt: future }, NOW)).toBe(false);
    expect(isAttemptEligible({ status: 'DEAD' }, NOW)).toBe(false);
    expect(isAttemptEligible({ status: 'SUCCESS' }, NOW)).toBe(false);
    expect(isAttemptEligible({ status: 'SKIPPED' }, NOW)).toBe(false);
  });
});

function retryHarness(attemptRows: any[]) {
  const byId = new Map(attemptRows.map((a) => [a.id, { ...a }]));
  const enqueued: any[] = [];
  const recordedAttempts: any[] = [];
  const prisma: any = {
    syncAttempt: {
      findMany: jest.fn(async ({ where }: any = {}) => {
        let all = [...byId.values()];
        if (where?.id?.in) all = all.filter((a) => where.id.in.includes(a.id));
        if (where?.storeId) all = all.filter((a) => a.storeId === where.storeId);
        if (where?.status?.in) all = all.filter((a) => where.status.in.includes(a.status));
        return all.map((a) => ({ ...a }));
      }),
      findUnique: jest.fn(async ({ where }: any) => (byId.has(where.id) ? { ...byId.get(where.id) } : null)),
      update: jest.fn(async ({ where, data }: any) => {
        const cur = byId.get(where.id);
        const next = { ...cur, ...data };
        byId.set(where.id, next);
        return next;
      }),
    },
  };
  const runs: any = {
    begin: jest.fn(async (opts: any) => ({ id: `run-${opts.scope}` })),
    recordAttempt: jest.fn(async (a: any) => { recordedAttempts.push(a); }),
  };
  const queues: any = { enqueue: jest.fn(async (q: string, name: string, data: any) => { enqueued.push({ q, name, data }); }) };
  const modules: any = { get: jest.fn(() => null) };
  const svc = new SyncRetryService(prisma, runs, queues, modules);
  return { svc, prisma, runs, queues, enqueued, recordedAttempts, byId };
}

describe('SyncRetryService enqueue paths (P11)', () => {
  it('retryByIds enqueues eligible rows and reports unknown/SUCCESS as skipped', async () => {
    const { svc, queues, enqueued } = retryHarness([
      { id: 'a1', storeId: 's1', objectType: 'PRODUCT', objectKey: 'k1', productId: 'p1', status: 'FAILED' },
      { id: 'a2', storeId: 's1', objectType: 'PRODUCT', objectKey: 'k2', productId: 'p2', status: 'SUCCESS' },
    ]);
    const res = await svc.retryByIds(['a1', 'a2', 'ghost']);
    expect(res.retried).toBe(1);
    expect(res.skippedIds).toEqual(expect.arrayContaining(['a2', 'ghost']));
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueued[0].data.productId).toBe('p1');
    expect(enqueued[0].q).toBe('store-product-sync');
  });

  it('retryAllEligible sweeps only due PENDING/FAILED rows (bounded)', async () => {
    const { svc, queues } = retryHarness([
      { id: 'due-1', storeId: 's1', objectType: 'PRODUCT', objectKey: 'k1', productId: 'p1', status: 'PENDING', nextRetryAt: past },
      { id: 'wait-1', storeId: 's1', objectType: 'PRODUCT', objectKey: 'k2', productId: 'p2', status: 'PENDING', nextRetryAt: future },
      { id: 'dead-1', storeId: 's1', objectType: 'PRODUCT', objectKey: 'k3', productId: 'p3', status: 'DEAD' },
    ]);
    const res = await svc.retryAllEligible('s1', 'actor-1', undefined, NOW);
    expect(res.retried).toBe(1);
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });

  it('ignoreAttempt marks SKIPPED with the operator note (audited, never resolving)', async () => {
    const { svc, byId } = retryHarness([
      { id: 'a9', storeId: 's1', objectType: 'PRODUCT', objectKey: 'k9', status: 'FAILED', errorMessage: 'timeout' },
    ]);
    await svc.ignoreAttempt('a9', 'provider incident, will re-push tomorrow');
    expect(byId.get('a9').status).toBe('SKIPPED');
    expect(byId.get('a9').errorMessage).toMatch(/provider incident/);
  });

  it('ORDER attempts fan out to the reconcile queue, not product-sync', async () => {
    const { svc, queues, enqueued } = retryHarness([
      { id: 'o1', storeId: 's1', objectType: 'ORDER', objectKey: 'store:s1:ingest:d1', status: 'FAILED' },
    ]);
    await svc.retryByIds(['o1']);
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueued[0].q).toBe('store-reconcile');
  });
});

describe('real-failure retry without duplication (FakeProvider, P11)', () => {
  it('transient failure then retry leaves exactly ONE remote product (same ref)', async () => {
    const fake = new FakeProvider();
    fake.injectFailure({ method: 'upsertProduct', times: 1, category: ProviderErrorCategory.TEMPORARY_FAILURE, message: 'flaky network' });
    const store: any = { id: 's1', kind: 'CUSTOM' };
    const input = { sku: 'RETRY-1', name: 'Retry Tee' };
    await expect(fake.upsertProduct(store, input as any, ['name', 'sku'])).rejects.toThrow('flaky network');
    const ref1 = await fake.upsertProduct(store, input as any, ['name', 'sku']);
    // The retry is the SAME idempotent upsert (SKU-keyed): same ref, one row.
    const ref2 = await fake.upsertProduct(store, input as any, ['name', 'sku']);
    expect(ref1).toEqual(ref2);
    expect(fake.productCount()).toBe(1);
    expect(fake.findBySku('RETRY-1')?.fields.name).toBe('Retry Tee');
  });
});
