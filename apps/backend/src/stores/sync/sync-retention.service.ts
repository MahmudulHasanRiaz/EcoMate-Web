/**
 * Sync retention lifecycle — central-commerce BR-19 + §12 (P11).
 *
 * Bounds (binding):
 * - `SyncRun` / `SyncRunItem` — 30 days
 * - `SyncAttempt` — 90 days
 * - `StoreSyncIssue` OPEN — kept (compact current-state row, never deleted
 *   here); RESOLVED / IGNORED — 90 days (by `resolvedAt`, falling back to
 *   `lastSeenAt` when `resolvedAt` is null)
 * - `StoreWebhookDelivery` — 30 days (by `lastSeenAt`)
 * - `StoreHealthCheck` — 30 days (by `checkedAt`)
 *
 * Properties: honours `isRestoreWriteBlocked()` (deferred, never writes
 * during a restore); bounded per run (`RETENTION_PURGE_BATCH` ids per table
 * per run — never an unbounded sweep); SELF-REPORTING failure (a purge
 * failure finishes a MAINTENANCE run as FAILED, upserts a
 * `RETENTION_PURGE_FAILED` issue where a store exists, and always logs —
 * it can never fail silently). Additive only: no migration, no schema
 * change. BullMQ repeatable registration lives in `sync-retention.scheduler`.
 *
 * Controlled-clock design: `purge(now)` takes the clock as a parameter (the
 * scheduler passes `new Date()`); tests pass fixed clocks to prove the
 * 30/90-day claims deterministically.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../queue/email-queue/email-queue.service';
import { logSync, resolveCorrelationId } from './store-sync-logger';

export const SYNC_RUN_RETENTION_DAYS = 30;
export const SYNC_ATTEMPT_RETENTION_DAYS = 90;
export const SYNC_ISSUE_RESOLVED_RETENTION_DAYS = 90;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
export const HEALTH_CHECK_RETENTION_DAYS = 30;
/** Max rows deleted per table per purge run (bounded — §12). */
export const RETENTION_PURGE_BATCH = 1000;

const DAY_MS = 24 * 3600 * 1000;

export interface RetentionCutoffs {
  runCutoff: Date;
  attemptCutoff: Date;
  issueCutoff: Date;
  deliveryCutoff: Date;
  healthCutoff: Date;
}

/** Pure cutoff computation over an explicit clock (unit-tested). */
export function retentionCutoffs(now: Date): RetentionCutoffs {
  const t = now.getTime();
  return {
    runCutoff: new Date(t - SYNC_RUN_RETENTION_DAYS * DAY_MS),
    attemptCutoff: new Date(t - SYNC_ATTEMPT_RETENTION_DAYS * DAY_MS),
    issueCutoff: new Date(t - SYNC_ISSUE_RESOLVED_RETENTION_DAYS * DAY_MS),
    deliveryCutoff: new Date(t - WEBHOOK_DELIVERY_RETENTION_DAYS * DAY_MS),
    healthCutoff: new Date(t - HEALTH_CHECK_RETENTION_DAYS * DAY_MS),
  };
}

export interface RetentionPurgeResult {
  deferred?: boolean;
  runs: number;
  items: number;
  attempts: number;
  issues: number;
  deliveries: number;
  healthChecks: number;
}

const ZERO: RetentionPurgeResult = { runs: 0, items: 0, attempts: 0, issues: 0, deliveries: 0, healthChecks: 0 };

@Injectable()
export class SyncRetentionService {
  private readonly logger = new Logger(SyncRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailQueue?: EmailQueueService,
  ) {}

  /**
   * One bounded purge pass. Creates its own MAINTENANCE/SYSTEM run for
   * audit; on failure the run finishes FAILED and the failure is reported
   * as both an issue (where a store row exists) and a log — never silent.
   */
  async purge(now: Date = new Date(), correlationId?: string): Promise<RetentionPurgeResult> {
    if (await this.prisma.isRestoreWriteBlocked()) {
      this.logger.debug('sync-retention: purge deferred while a restore owns the database');
      return { ...ZERO, deferred: true };
    }
    const cid = resolveCorrelationId(correlationId);
    const cutoffs = retentionCutoffs(now);
    const auditRun = await this.prisma.syncRun
      .create({ data: { scope: 'MAINTENANCE' as any, triggerType: 'SYSTEM' as any, status: 'RUNNING' as any, correlationId: cid } })
      .catch(() => null);
    const auditRunId = (auditRun as any)?.id as string | undefined;
    try {
      const items = await this.purgeIds('syncRunItem', { createdAt: { lt: cutoffs.runCutoff } });
      const runs = await this.purgeIds('syncRun', { startedAt: { lt: cutoffs.runCutoff } });
      const attempts = await this.purgeIds('syncAttempt', { createdAt: { lt: cutoffs.attemptCutoff } });
      const issues = await this.purgeResolvedIssues(cutoffs.issueCutoff);
      const deliveries = await this.purgeIds('storeWebhookDelivery', { lastSeenAt: { lt: cutoffs.deliveryCutoff } });
      const healthChecks = await this.purgeIds('storeHealthCheck', { checkedAt: { lt: cutoffs.healthCutoff } });
      const result: RetentionPurgeResult = { runs, items, attempts, issues, deliveries, healthChecks };
      if (auditRunId) {
        await this.prisma.syncRun
          .update({
            where: { id: auditRunId },
            data: {
              status: 'SUCCESS' as any,
              finishedAt: now,
              skippedCount: 0,
              createdCount: 0,
              updatedCount: 0,
              failedCount: 0,
              totalCount: runs + items + attempts + issues + deliveries + healthChecks,
            },
          })
          .catch(() => undefined);
      }
      logSync(this.logger, 'log', 'sync-retention: purge complete', {
        runId: auditRunId,
        correlationId: cid,
        status: 'SUCCESS',
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logSync(this.logger, 'error', `sync-retention: purge FAILED (self-reporting): ${message}`, {
        runId: auditRunId,
        correlationId: cid,
        status: 'FAILED',
        errorCategory: 'RETENTION_PURGE_FAILED',
      });
      // Self-report: FAILED audit run + compact OPEN issue (best-effort each).
      if (auditRunId) {
        await this.prisma.syncRun
          .update({ where: { id: auditRunId }, data: { status: 'FAILED' as any, finishedAt: now, failedCount: 1, totalCount: 1 } })
          .catch(() => undefined);
      }
      await this.reportPurgeFailure(message).catch(() => undefined);
      throw err;
    }
  }

  /** Bounded delete: at most RETENTION_PURGE_BATCH ids per call. */
  private async purgeIds(model: 'syncRun' | 'syncRunItem' | 'syncAttempt' | 'storeWebhookDelivery' | 'storeHealthCheck', where: Record<string, unknown>): Promise<number> {
    const delegate = (this.prisma as any)[model];
    if (!delegate?.findMany || !delegate?.deleteMany) return 0;
    const rows = await delegate.findMany({ where, select: { id: true }, take: RETENTION_PURGE_BATCH });
    if (rows.length === 0) return 0;
    const res = await delegate.deleteMany({ where: { id: { in: rows.map((r: any) => r.id) } } });
    return (res?.count ?? 0) as number;
  }

  /**
   * RESOLVED/IGNORED issues older than 90 days. OPEN rows are NEVER deleted
   * here (BR-19 compact-state rule). Bounded per run.
   */
  private async purgeResolvedIssues(cutoff: Date): Promise<number> {
    const delegate = (this.prisma as any).storeSyncIssue;
    if (!delegate?.findMany || !delegate?.deleteMany) return 0;
    const rows = await delegate.findMany({
      where: {
        status: { in: ['RESOLVED', 'IGNORED'] as any },
        OR: [{ resolvedAt: { lt: cutoff } }, { resolvedAt: null, lastSeenAt: { lt: cutoff } }],
      },
      select: { id: true },
      take: RETENTION_PURGE_BATCH,
    });
    if (rows.length === 0) return 0;
    const res = await delegate.deleteMany({ where: { id: { in: rows.map((r: any) => r.id) } } });
    return (res?.count ?? 0) as number;
  }

  /**
   * Self-report a purge failure as a compact OPEN issue. Issues require a
   * `storeId`, so the failure is attached to the first store row when one
   * exists; with no stores the FAILED audit run + error log above remain
   * the visible record (still never silent).
   */
  private async reportPurgeFailure(message: string): Promise<void> {
    const store = await this.prisma.store.findFirst({ select: { id: true } }).catch(() => null);
    if (!(store as any)?.id) return;
    const storeId = (store as any).id as string;
    const key = 'global:retention-purge';
    const existing = await (this.prisma as any).storeSyncIssue
      .findUnique({ where: { storeId_code_objectKey: { storeId, code: 'RETENTION_PURGE_FAILED', objectKey: key } } })
      .catch(() => null);
    if (existing) {
      await (this.prisma as any).storeSyncIssue
        .update({ where: { id: existing.id }, data: { occurrences: { increment: 1 }, message: `Retention purge failed: ${message}` } })
        .catch(() => undefined);
    } else {
      await (this.prisma as any).storeSyncIssue
        .create({
          data: {
            storeId,
            code: 'RETENTION_PURGE_FAILED',
            objectType: 'PRODUCT' as any,
            objectKey: key,
            message: `Retention purge failed: ${message}`,
            status: 'OPEN' as any,
          },
        })
        .catch(() => undefined);
    }
    // Best-effort operator email (never throws).
    try {
      const to = process.env['SYNC_FAILURE_NOTIFY_EMAIL'] ?? process.env['ADMIN_EMAIL'];
      if (to && this.emailQueue) {
        await this.emailQueue.send({
          to,
          subject: '[EcoMate sync] Retention purge failed',
          template: 'notification',
          context: { content: `The sync retention purge failed and reported itself:\n\n${message}` },
        });
      }
    } catch {
      // Swallowed deliberately: the log + issue above are the record.
    }
  }
}
