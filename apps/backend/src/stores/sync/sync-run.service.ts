/**
 * SyncRunService — central-commerce §8.1 (P4) + P11 operations.
 *
 * Owns SyncRun begin/finish (+windowDays/wideningReason), SyncRunItem writes
 * and SyncAttempt history. `finish()` computes PARTIAL when failed > 0 AND
 * (created + updated) > 0. All writes awaited — never swallowed (§4.2).
 *
 * P11: `begin()` resolves the correlation id from `correlationIdStorage`
 * when the caller passes none (§10/§12 — the previously unused storage is
 * now wired in); every write emits a structured `store-sync` log line with
 * runId/storeId/provider/externalObjectId/correlationId/durationMs/status/
 * errorCategory. `SyncRun` carries `correlationId` as a real column;
 * `SyncRunItem`/`SyncAttempt` have no provider/correlationId columns
 * (additive-only programme — no migration in P11), so those two travel in
 * the log line. Repeated-failure emails fan out best-effort via
 * SyncNotifyService (never throws into the engine).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { currentCorrelationId, logSync } from './store-sync-logger';
import { SyncNotifyService } from './sync-notify.service';

export type SyncScope = 'PRODUCT' | 'STOCK' | 'ORDER_INGEST' | 'ORDER_PUSH' | 'RECONCILE' | 'MAINTENANCE' | 'PUBLISH';
export type TriggerType = 'MANUAL' | 'SCHEDULED' | 'WEBHOOK' | 'RETRY' | 'SYSTEM';

@Injectable()
export class SyncRunService {
  private readonly logger = new Logger(SyncRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notify?: SyncNotifyService,
  ) {}

  async begin(opts: {
    scope: SyncScope;
    triggerType?: TriggerType;
    storeId?: string;
    initiatedById?: string;
    windowDays?: number;
    wideningReason?: string;
    correlationId?: string;
  }) {
    // P11 §10/§12: ambient request correlation id when the caller passes none.
    const correlationId = opts.correlationId ?? currentCorrelationId() ?? randomUUID();
    const run = await this.prisma.syncRun.create({
      data: {
        scope: opts.scope as any,
        triggerType: (opts.triggerType ?? 'MANUAL') as any,
        storeId: opts.storeId,
        initiatedById: opts.initiatedById,
        windowDays: opts.windowDays,
        wideningReason: opts.wideningReason,
        correlationId,
        status: 'RUNNING' as any,
      },
    });
    logSync(this.logger, 'log', 'sync-run: begin', {
      runId: (run as any)?.id,
      storeId: opts.storeId,
      correlationId,
      status: 'RUNNING',
      scope: opts.scope,
    });
    return run;
  }

  async recordItem(
    runId: string,
    item: {
      storeId?: string;
      productId?: string;
      objectType: string;
      externalObjectId?: string;
      status: string;
      reason?: string;
      field?: string;
      auditLevel?: string;
      durationMs?: number;
      errorCategory?: string;
      /** No DB column (P11 additive-only) — carried in the structured log. */
      provider?: string;
      /** No DB column (P11 additive-only) — carried in the structured log. */
      correlationId?: string;
    },
  ) {
    await this.prisma.syncRunItem.create({
      data: {
        runId,
        storeId: item.storeId,
        productId: item.productId,
        objectType: item.objectType as any,
        externalObjectId: item.externalObjectId,
        status: item.status as any,
        reason: item.reason,
        field: item.field,
        auditLevel: item.auditLevel,
        durationMs: item.durationMs,
        errorCategory: item.errorCategory,
      },
    });
    logSync(this.logger, item.status === 'FAILED' ? 'warn' : 'log', 'sync-run: item', {
      runId,
      storeId: item.storeId,
      provider: item.provider,
      externalObjectId: item.externalObjectId,
      correlationId: item.correlationId,
      durationMs: item.durationMs,
      status: item.status,
      errorCategory: item.errorCategory,
      objectType: item.objectType,
    });
  }

  async recordAttempt(attempt: {
    runId?: string;
    storeId?: string;
    objectType: string;
    objectKey: string;
    productId?: string;
    field?: string;
    attemptNo?: number;
    status: string;
    errorCategory?: string;
    errorMessage?: string;
    nextRetryAt?: Date;
    /** No DB column (P11 additive-only) — carried in the structured log. */
    provider?: string;
    /** No DB column (P11 additive-only) — carried in the structured log. */
    correlationId?: string;
    /** Observed wall time for the attempt (logged; no DB column). */
    durationMs?: number;
    /** Remote identity when known (logged; DB carries it via objectKey). */
    externalObjectId?: string;
  }) {
    await this.prisma.syncAttempt.create({
      data: {
        runId: attempt.runId,
        storeId: attempt.storeId,
        objectType: attempt.objectType as any,
        objectKey: attempt.objectKey,
        productId: attempt.productId,
        field: attempt.field,
        attemptNo: attempt.attemptNo ?? 1,
        status: attempt.status as any,
        errorCategory: attempt.errorCategory,
        errorMessage: attempt.errorMessage,
        nextRetryAt: attempt.nextRetryAt,
      },
    });
    logSync(this.logger, attempt.status === 'FAILED' || attempt.status === 'DEAD' ? 'warn' : 'log', 'sync-run: attempt', {
      runId: attempt.runId,
      storeId: attempt.storeId,
      provider: attempt.provider,
      externalObjectId: attempt.externalObjectId,
      correlationId: attempt.correlationId,
      durationMs: attempt.durationMs,
      status: attempt.status,
      errorCategory: attempt.errorCategory,
      objectType: attempt.objectType,
      objectKey: attempt.objectKey,
    });
  }

  async upsertIssue(issue: {
    storeId: string;
    code: string;
    objectType: string;
    objectKey: string;
    productId?: string;
    field?: string;
    message: string;
  }) {
    const existing = await this.prisma.storeSyncIssue.findUnique({
      where: { storeId_code_objectKey: { storeId: issue.storeId, code: issue.code, objectKey: issue.objectKey } },
    });
    // BR-19 compact-state rule: repeated failures update ONE row (occurrences
    // + message), never N rows — 200 failed attempts yield exactly one OPEN
    // issue (proven in sync-retention.spec).
    let row: any;
    if (existing) {
      row = await this.prisma.storeSyncIssue.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 }, message: issue.message },
      });
    } else {
      row = await this.prisma.storeSyncIssue.create({
        data: {
          storeId: issue.storeId,
          code: issue.code,
          objectType: issue.objectType as any,
          objectKey: issue.objectKey,
          productId: issue.productId,
          field: issue.field,
          message: issue.message,
          status: 'OPEN' as any,
        },
      });
    }
    logSync(this.logger, 'warn', `sync-run: issue ${issue.code}`, {
      storeId: issue.storeId,
      status: row?.status ?? 'OPEN',
      objectType: issue.objectType,
      objectKey: issue.objectKey,
    });
    // Repeated-failure email: best-effort, never throws into the engine.
    if (this.notify && row?.occurrences) {
      await this.notify
        .notifyIfRepeated(issue.storeId, {
          code: issue.code,
          objectKey: issue.objectKey,
          occurrences: row.occurrences as number,
          message: issue.message,
        })
        .catch(() => undefined);
    }
    return row;
  }

  async finish(runId: string, counts: { created: number; updated: number; skipped?: number; failed: number }) {
    const failed = counts.failed;
    const succeeded = counts.created + counts.updated;
    const status = failed === 0 ? 'SUCCESS' : succeeded > 0 ? 'PARTIAL' : 'FAILED';
    return this.prisma.syncRun.update({
      where: { id: runId },
      data: {
        status: status as any,
        createdCount: counts.created,
        updatedCount: counts.updated,
        skippedCount: counts.skipped ?? 0,
        failedCount: failed,
        totalCount: succeeded + failed + (counts.skipped ?? 0),
        finishedAt: new Date(),
      },
    });
  }

  async cancel(runId: string) {
    return this.prisma.syncRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED' as any, finishedAt: new Date() },
    });
  }

  async countAttempts(storeId: string, objectKey: string): Promise<number> {
    return (this.prisma as any).syncAttempt.count({ where: { storeId, objectKey } });
  }
}
