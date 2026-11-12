import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ReconciliationFixAllService } from './reconciliation-fix-all.service';

/**
 * Reconciliation one-click fix-all tests (2026-11-12, recon
 * simplification round): auto-backup → apply → Q8 settle → post-report,
 * with fail-closed behaviour when the backup fails or times out, and
 * the settle skipped for non-superadmins. All collaborators are mocked;
 * the real apply/settle/backup services are NOT touched.
 */

const row = (id: string, category: string, r8Kind?: string) => ({
  id,
  category,
  ...(r8Kind ? { r8Kind } : {}),
});

const reportWith = (rows: any[]) => ({
  generatedAt: new Date().toISOString(),
  imEnabled: true,
  rows,
  counts: {
    R1: 0, R2: 0, R3: 0, R4: 0, R5: {}, R6: 0, R7: 0, R8: 0, R8H: 0,
  },
  checks: [],
});

const MIXED_ROWS = [
  row('R1|a', 'R1'),
  row('R2|a', 'R2'),
  row('R6|a', 'R6'),
  row('R8|term', 'R8', 'terminal'),
  row('R8|pend', 'R8', 'pending'),
  row('R8|h', 'R8', 'human'),
  row('R7|a', 'R7'),
  row('R3|a', 'R3'),
  row('R4|a', 'R4'),
];

function makeService(opts: any = {}) {
  const prisma: any = {
    reconciliationRun: {
      findFirst: jest.fn(async () => opts.running ?? null),
    },
  };
  const finder: any = {
    buildReport: jest.fn(async () =>
      opts.report ?? reportWith(MIXED_ROWS),
    ),
  };
  const apply: any = {
    apply: jest.fn(async (input: any) => ({
      runId: 'run-fix-1',
      applied: input.rowIds,
      skipped: [],
      checks: [],
      idempotency: { ok: true, remainingR1R2: 0, remainingR6: 0, remainingR8: 0 },
    })),
  };
  // Backup job lifecycle the test controls: a queue of statuses the
  // poller sees, in order (last one repeats).
  const backupStatuses: string[] = opts.backupStatuses ?? ['completed'];
  let pollCount = 0;
  const backup: any = {
    triggerManual: jest.fn(async () => ({ id: 'bk-1' })),
    getBackup: jest.fn(async () => {
      const status =
        backupStatuses[Math.min(pollCount, backupStatuses.length - 1)];
      pollCount += 1;
      return {
        id: 'bk-1',
        status,
        fileKey: status === 'completed' ? 'backups/bk-1.dump' : null,
        errorMessage:
          status === 'failed' ? opts.backupError ?? 'disk full' : null,
      };
    }),
  };
  const settle: any = {
    settle: jest.fn(async () => ({
      dryRun: false,
      settled: {
        releasedUnits: 2,
        flagsCleared: 4,
        ledgerEntries: ['Q8 settlement — released 2 reserved unit(s)'],
      },
      remainingFails: 0,
      detail: 'Settled 1 orphaned unit(s).',
    })),
  };
  const service = new ReconciliationFixAllService(
    prisma,
    finder,
    apply,
    backup,
    settle,
    { pollIntervalMs: 1, pollTimeoutMs: opts.pollTimeoutMs ?? 50 },
  );
  return { service, prisma, finder, apply, backup, settle };
}

const baseInput = {
  performedBy: 'boss@example.com',
  isSuperAdmin: true,
  confirmed: true,
};

describe('ReconciliationFixAllService', () => {
  it('happy path: backup completes → apply → settle → post-report', async () => {
    const { service, finder, apply, backup, settle } = makeService();
    const out = await service.fixAll(baseInput);

    expect(backup.triggerManual).toHaveBeenCalledWith('db_only');
    expect(backup.getBackup).toHaveBeenCalledWith('bk-1');
    // Only R1/R2/R6 + backfillable R8 reach apply; R7 / R8-H / R3 / R4
    // are excluded by construction.
    expect(apply.apply).toHaveBeenCalledWith({
      performedBy: 'boss@example.com',
      backupId: 'bk-1',
      confirmed: true,
      rowIds: ['R1|a', 'R2|a', 'R6|a', 'R8|term', 'R8|pend'],
    });
    expect(settle.settle).toHaveBeenCalledWith({
      dryRun: false,
      performedBy: 'boss@example.com',
    });
    // Two finder builds: pre-fix row collection + post-fix report.
    expect(finder.buildReport).toHaveBeenCalledTimes(2);
    expect(out.backupId).toBe('bk-1');
    expect(out.apply.runId).toBe('run-fix-1');
    expect(out.apply.applied).toEqual([
      'R1|a', 'R2|a', 'R6|a', 'R8|term', 'R8|pend',
    ]);
    expect(out.apply.idempotency).toEqual({
      ok: true, remainingR1R2: 0, remainingR6: 0, remainingR8: 0,
    });
    expect(out.settle).toEqual({
      ran: true,
      releasedUnits: 2,
      flagsCleared: 4,
      ledgerEntries: ['Q8 settlement — released 2 reserved unit(s)'],
      remainingFails: 0,
      detail: 'Settled 1 orphaned unit(s).',
    });
    expect(out.postReport).toEqual({
      counts: expect.objectContaining({ R1: 0, R8H: 0 }),
      checks: [],
    });
    expect(typeof out.generatedAt).toBe('string');
  });

  it('backup timeout is fail-closed: apply and settle are NEVER called', async () => {
    const { service, apply, settle, backup } = makeService({
      backupStatuses: ['pending', 'running'],
      pollTimeoutMs: 10,
    });
    await expect(service.fixAll(baseInput)).rejects.toThrow(
      /did not finish within .* — nothing was applied/,
    );
    expect(backup.triggerManual).toHaveBeenCalledTimes(1);
    expect(apply.apply).not.toHaveBeenCalled();
    expect(settle.settle).not.toHaveBeenCalled();
  });

  it('backup failure is fail-closed and names the backup error', async () => {
    const { service, apply, settle } = makeService({
      backupStatuses: ['running', 'failed'],
      backupError: 'pg_dump exited 1',
    });
    await expect(service.fixAll(baseInput)).rejects.toThrow(
      /Automatic backup bk-1 failed: pg_dump exited 1 — nothing was applied/,
    );
    expect(apply.apply).not.toHaveBeenCalled();
    expect(settle.settle).not.toHaveBeenCalled();
  });

  it('non-superadmin: apply still runs, settle NEVER runs', async () => {
    const { service, apply, settle } = makeService();
    const out = await service.fixAll({
      ...baseInput,
      isSuperAdmin: false,
    });
    expect(apply.apply).toHaveBeenCalledTimes(1);
    expect(settle.settle).not.toHaveBeenCalled();
    expect(out.settle).toEqual({
      ran: false,
      reason: 'Q8 settle needs a superadmin — run it from the details view.',
    });
  });

  it('superadmin: settle runs after apply', async () => {
    const { service, apply, settle } = makeService();
    await service.fixAll(baseInput);
    expect(apply.apply).toHaveBeenCalledTimes(1);
    expect(settle.settle).toHaveBeenCalledTimes(1);
    // Order: apply before settle (settle is called after apply resolves).
    expect(apply.apply.mock.invocationCallOrder[0]).toBeLessThan(
      settle.settle.mock.invocationCallOrder[0],
    );
  });

  it('confirmed=false is refused before any backup or write', async () => {
    const { service, apply, backup, settle, finder } = makeService();
    await expect(
      service.fixAll({ ...baseInput, confirmed: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(backup.triggerManual).not.toHaveBeenCalled();
    expect(finder.buildReport).not.toHaveBeenCalled();
    expect(apply.apply).not.toHaveBeenCalled();
    expect(settle.settle).not.toHaveBeenCalled();
  });

  it('a RUNNING run is a 409 before any backup is created', async () => {
    const { service, backup, apply, finder } = makeService({
      running: { id: 'run-live' },
    });
    await expect(service.fixAll(baseInput)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(backup.triggerManual).not.toHaveBeenCalled();
    expect(finder.buildReport).not.toHaveBeenCalled();
    expect(apply.apply).not.toHaveBeenCalled();
  });

  it('a stale RUNNING run (older than 30 min) does not block fix-all', async () => {
    // The pre-check only sees fresh RUNNING rows; the apply service's
    // own stale sweep owns crashed runs. findFirst is scoped by
    // createdAt in the service, so a stale row is invisible here.
    const prisma: any = {
      reconciliationRun: {
        findFirst: jest.fn(async (args: any) => {
          // Simulate the DB: no fresh RUNNING row exists.
          expect(args.where.status).toBe('RUNNING');
          expect(args.where.createdAt.gte).toBeInstanceOf(Date);
          return null;
        }),
      },
    };
    const { service, apply } = (() => {
      const built = makeService();
      return {
        service: new ReconciliationFixAllService(
          prisma,
          built.finder,
          built.apply,
          built.backup,
          built.settle,
          { pollIntervalMs: 1, pollTimeoutMs: 50 },
        ),
        apply: built.apply,
      };
    })();
    const out = await service.fixAll(baseInput);
    expect(apply.apply).toHaveBeenCalledTimes(1);
    expect(out.backupId).toBe('bk-1');
  });
});
