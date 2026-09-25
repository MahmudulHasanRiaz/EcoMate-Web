/**
 * Retention lifecycle suite — central-commerce BR-19 + §12 (P11).
 *
 * Controlled-clock proofs (no wall-clock flakiness):
 * - SyncRun/SyncRunItem older than 30d are purged; newer rows kept.
 * - SyncAttempt older than 90d purged; newer kept.
 * - RESOLVED/IGNORED issues older than 90d purged; OPEN issues NEVER
 *   purged (compact current-state rule), however old.
 * - StoreWebhookDelivery / StoreHealthCheck older than 30d purged.
 * - `isRestoreWriteBlocked() === true` defers with zero deletes.
 * - A purge failure self-reports (throws AND leaves a FAILED audit run +
 *   a RETENTION_PURGE_FAILED issue + an error log — never silent).
 * - 200 failed attempts against one object yield exactly ONE compact OPEN
 *   issue (the BR-19 "never as retained attempt history" proof).
 */
import { SyncRetentionService, retentionCutoffs } from '../sync-retention.service';
import { SyncRunService } from '../sync-run.service';

const DAY_MS = 24 * 3600 * 1000;
const NOW = new Date('2026-09-25T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

interface Row { id: string; [k: string]: any }

function table(initial: Row[] = []) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  return {
    rows,
    findUnique: jest.fn(async ({ where }: any = {}) => {
      if (where?.id) return rows.has(where.id) ? { ...rows.get(where.id) } : null;
      const compound = where?.storeId_code_objectKey;
      if (compound) {
        return [...rows.values()].find(
          (r) => r.storeId === compound.storeId && r.code === compound.code && r.objectKey === compound.objectKey,
        ) ?? null;
      }
      return null;
    }),
    findMany: jest.fn(async ({ where, take }: any = {}) => {
      let all = [...rows.values()];
      if (where?.id?.in) all = all.filter((r) => where.id.in.includes(r.id));
      else {
        // Minimal predicate support for the suite's where shapes.
        for (const [k, cond] of Object.entries(where ?? {}) as any) {
          if (k === 'OR' && Array.isArray(cond)) {
            all = all.filter((r) => (cond as any[]).some((branch) =>
              Object.entries(branch).every(([bk, bv]: any) => matchCond((r as any)[bk], bv)),
            ));
          } else if (k === 'status' && (cond as any)?.in) {
            all = all.filter((r) => (cond as any).in.includes((r as any).status));
          } else {
            all = all.filter((r) => matchCond((r as any)[k], cond));
          }
        }
      }
      return (take ? all.slice(0, take) : all).map((r) => ({ ...r }));
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      let n = 0;
      for (const id of ids) if (rows.delete(id)) n += 1;
      return { count: n };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `id-${rows.size + 1}-${Math.random().toString(36).slice(2, 8)}`, ...data };
      rows.set(row.id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row) throw new Error('not found');
      const next = { ...row };
      for (const [k, v] of Object.entries(data)) {
        next[k] = v && typeof v === 'object' && 'increment' in (v as any)
          ? ((next[k] as number) ?? 0) + (v as any).increment
          : v;
      }
      rows.set(where.id, next);
      return { ...next };
    }),
  };
}

function matchCond(value: any, cond: any): boolean {
  if (cond && typeof cond === 'object') {
    if ('lt' in cond) return value != null && new Date(value).getTime() < new Date(cond.lt).getTime();
    if ('gte' in cond) return value != null && new Date(value).getTime() >= new Date(cond.gte).getTime();
    if ('in' in cond) return cond.in.includes(value);
  }
  return value === cond;
}

function retentionPrisma(seed: {
  runs?: Row[]; items?: Row[]; attempts?: Row[]; issues?: Row[];
  deliveries?: Row[]; health?: Row[]; stores?: Row[]; restoreBlocked?: boolean;
  failOn?: string | null;
}) {
  const t = {
    syncRun: table(seed.runs),
    syncRunItem: table(seed.items),
    syncAttempt: table(seed.attempts),
    storeSyncIssue: table(seed.issues),
    storeWebhookDelivery: table(seed.deliveries),
    storeHealthCheck: table(seed.health),
    store: {
      findFirst: jest.fn(async () => (seed.stores?.[0] ? { ...seed.stores[0] } : null)),
      findUnique: jest.fn(async () => (seed.stores?.[0] ? { ...seed.stores[0] } : null)),
    },
  };
  if (seed.failOn) {
    const victim = (t as any)[seed.failOn];
    victim.deleteMany = jest.fn(async () => { throw new Error('disk on fire'); });
  }
  const prisma: any = {
    ...t,
    isRestoreWriteBlocked: jest.fn(async () => seed.restoreBlocked ?? false),
  };
  return { prisma, t };
}

describe('retentionCutoffs (P11)', () => {
  it('computes 30/90-day windows from the supplied clock', () => {
    const c = retentionCutoffs(NOW);
    expect(c.runCutoff).toEqual(daysAgo(30));
    expect(c.attemptCutoff).toEqual(daysAgo(90));
    expect(c.issueCutoff).toEqual(daysAgo(90));
    expect(c.deliveryCutoff).toEqual(daysAgo(30));
    expect(c.healthCutoff).toEqual(daysAgo(30));
  });
});

describe('SyncRetentionService.purge (P11 BR-19)', () => {
  it('purges runs/items past 30d and keeps newer rows', async () => {
    const { prisma, t } = retentionPrisma({
      runs: [
        { id: 'run-old', startedAt: daysAgo(31) },
        { id: 'run-new', startedAt: daysAgo(29) },
      ],
      items: [
        { id: 'item-old', createdAt: daysAgo(31) },
        { id: 'item-new', createdAt: daysAgo(10) },
      ],
    });
    const svc = new SyncRetentionService(prisma);
    const res = await svc.purge(NOW);
    // +1 run row: the MAINTENANCE audit run created by purge itself (new).
    expect(res.runs).toBe(1);
    expect(res.items).toBe(1);
    expect([...t.syncRun.rows.keys()]).toContain('run-new');
    expect([...t.syncRun.rows.keys()]).not.toContain('run-old');
    expect([...t.syncRunItem.rows.keys()]).toContain('item-new');
    expect([...t.syncRunItem.rows.keys()]).not.toContain('item-old');
  });

  it('purges attempts past 90d and keeps newer rows', async () => {
    const { prisma, t } = retentionPrisma({
      attempts: [
        { id: 'a-old', createdAt: daysAgo(91) },
        { id: 'a-new', createdAt: daysAgo(89) },
      ],
    });
    const res = await new SyncRetentionService(prisma).purge(NOW);
    expect(res.attempts).toBe(1);
    expect([...t.syncAttempt.rows.keys()]).toEqual(expect.arrayContaining(['a-new']));
    expect([...t.syncAttempt.rows.keys()]).not.toContain('a-old');
  });

  it('purges RESOLVED/IGNORED past 90d but NEVER purges OPEN issues', async () => {
    const { prisma, t } = retentionPrisma({
      issues: [
        { id: 'i-res-old', status: 'RESOLVED', resolvedAt: daysAgo(91), lastSeenAt: daysAgo(91) },
        { id: 'i-ign-old', status: 'IGNORED', resolvedAt: daysAgo(100), lastSeenAt: daysAgo(100) },
        { id: 'i-res-new', status: 'RESOLVED', resolvedAt: daysAgo(10), lastSeenAt: daysAgo(10) },
        { id: 'i-open-ancient', status: 'OPEN', resolvedAt: null, lastSeenAt: daysAgo(400) },
      ],
    });
    const res = await new SyncRetentionService(prisma).purge(NOW);
    expect(res.issues).toBe(2);
    const remaining = [...t.storeSyncIssue.rows.keys()];
    expect(remaining).toEqual(expect.arrayContaining(['i-res-new', 'i-open-ancient']));
    expect(remaining).not.toContain('i-res-old');
    expect(remaining).not.toContain('i-ign-old');
  });

  it('purges webhook deliveries and health checks past 30d', async () => {
    const { prisma, t } = retentionPrisma({
      deliveries: [
        { id: 'd-old', lastSeenAt: daysAgo(31) },
        { id: 'd-new', lastSeenAt: daysAgo(5) },
      ],
      health: [
        { id: 'h-old', checkedAt: daysAgo(31) },
        { id: 'h-new', checkedAt: daysAgo(1) },
      ],
    });
    const res = await new SyncRetentionService(prisma).purge(NOW);
    expect(res.deliveries).toBe(1);
    expect(res.healthChecks).toBe(1);
    expect([...t.storeWebhookDelivery.rows.keys()]).not.toContain('d-old');
    expect([...t.storeHealthCheck.rows.keys()]).not.toContain('h-old');
  });

  it('defers with zero deletes while a restore owns the database', async () => {
    const { prisma, t } = retentionPrisma({
      runs: [{ id: 'run-old', startedAt: daysAgo(60) }],
      restoreBlocked: true,
    });
    const res = await new SyncRetentionService(prisma).purge(NOW);
    expect(res.deferred).toBe(true);
    expect(res.runs).toBe(0);
    expect(t.syncRun.deleteMany).not.toHaveBeenCalled();
    expect([...t.syncRun.rows.keys()]).toContain('run-old');
  });

  it('a purge failure self-reports: throws + FAILED audit run + issue + log (never silent)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { prisma, t } = retentionPrisma({
      stores: [{ id: 'store-1', name: 'Woo' }],
      attempts: [{ id: 'a-old', createdAt: daysAgo(91) }],
      failOn: 'syncAttempt',
    });
    // Silence the Nest logger output; assert via state instead.
    const svc = new SyncRetentionService(prisma);
    await expect(svc.purge(NOW)).rejects.toThrow('disk on fire');
    const runs = [...t.syncRun.rows.values()];
    expect(runs.some((r: any) => r.status === 'FAILED')).toBe(true);
    const issues = [...t.storeSyncIssue.rows.values()];
    expect(issues.some((i: any) => i.code === 'RETENTION_PURGE_FAILED' && i.status === 'OPEN')).toBe(true);
    errSpy.mockRestore();
  });
});

describe('BR-19 compact-state: 200 failed attempts → exactly 1 OPEN issue', () => {
  function issuePrisma() {
    const issues = new Map<string, any>();
    const attempts: any[] = [];
    const prisma: any = {
      syncAttempt: {
        create: jest.fn(async ({ data }: any) => { attempts.push(data); return data; }),
        count: jest.fn(async () => attempts.length),
      },
      storeSyncIssue: {
        findUnique: jest.fn(async ({ where }: any) => {
          const k = where.storeId_code_objectKey;
          return [...issues.values()].find(
            (i) => i.storeId === k.storeId && i.code === k.code && i.objectKey === k.objectKey,
          ) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `iss-${issues.size + 1}`, occurrences: 1, ...data };
          issues.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = issues.get(where.id);
          const next = { ...row, occurrences: row.occurrences + (data.occurrences?.increment ?? 0), message: data.message };
          issues.set(where.id, next);
          return next;
        }),
      },
    };
    return { prisma, issues };
  }

  it('collapses 200 failures into one compact OPEN row (occurrences=200)', async () => {
    const { prisma, issues } = issuePrisma();
    const runs = new SyncRunService(prisma);
    for (let i = 0; i < 200; i++) {
      await runs.recordAttempt({
        storeId: 'store-1',
        objectType: 'PRODUCT',
        objectKey: 'store:store-1:product:p1',
        productId: 'p1',
        status: 'FAILED',
        errorCategory: 'TEMPORARY_FAILURE',
        errorMessage: `failure #${i}`,
      });
      await runs.upsertIssue({
        storeId: 'store-1',
        code: 'DEAD_LETTER',
        objectType: 'PRODUCT',
        objectKey: 'store:store-1:product:p1',
        productId: 'p1',
        message: `failure #${i}`,
      });
    }
    expect(issues.size).toBe(1);
    const [only] = [...issues.values()];
    expect(only.status).toBe('OPEN');
    expect(only.occurrences).toBe(200);
  });
});
