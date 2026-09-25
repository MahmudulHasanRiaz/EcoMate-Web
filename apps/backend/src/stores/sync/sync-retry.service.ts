/**
 * Sync retry center — central-commerce P11 (§11 Failed & Retry).
 *
 * Retry now (one attempt) / selected (id list) / all-eligible (bounded
 * sweep) / ignore with notes. Eligible = `PENDING` or `FAILED` with
 * `nextRetryAt` due (null or past); `DEAD` rows are excluded from the
 * all-eligible sweep but remain explicitly retryable by id (operator
 * intent). `SUCCESS`/`SKIPPED` rows are never retried.
 *
 * No-duplication guarantee: retries re-run the idempotent engine paths
 * (product upsert keyed by SKU — the same remote ref is reused, never a
 * second remote product; order ingest keyed by `StoreOrderMapping` +
 * delivery identity). The HTTP layer only enqueues (BR-21); the worker (or
 * `executeRetry`, used by tests) performs the work.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncRunService } from './sync-run.service';
import { SyncQueuesService } from './sync-queues.service';
import { logSync, resolveCorrelationId } from './store-sync-logger';

const ELIGIBLE_STATUSES = ['PENDING', 'FAILED'] as const;

/** Pure eligibility predicate (unit-tested, mirrored in admin UI gating). */
export function isAttemptEligible(
  attempt: { status: string; nextRetryAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (!(ELIGIBLE_STATUSES as readonly string[]).includes(attempt.status)) return false;
  if (attempt.nextRetryAt == null) return true;
  return new Date(attempt.nextRetryAt).getTime() <= now.getTime();
}

export interface RetryEnqueueResult {
  runIds: string[];
  retried: number;
  skipped: number;
  skippedIds: string[];
}

@Injectable()
export class SyncRetryService {
  private readonly logger = new Logger(SyncRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly modules: ModuleRef,
  ) {}

  /** Retry one attempt now: creates a RETRY run and enqueues (BR-21). */
  async retryOne(attemptId: string, actorId?: string, correlationId?: string): Promise<RetryEnqueueResult> {
    return this.retryByIds([attemptId], actorId, correlationId);
  }

  /** Retry the selected attempt ids (explicit operator intent). */
  async retryByIds(attemptIds: string[], actorId?: string, correlationId?: string): Promise<RetryEnqueueResult> {
    const cid = resolveCorrelationId(correlationId);
    const rows = (await (this.prisma as any).syncAttempt.findMany({ where: { id: { in: attemptIds } } })) as any[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const retryable = rows.filter((r) => r.status !== 'SUCCESS' && r.status !== 'SKIPPED');
    const skippedIds = attemptIds.filter((id) => !byId.has(id) || (byId.get(id).status as string) === 'SUCCESS' || (byId.get(id).status as string) === 'SKIPPED');
    if (retryable.length === 0) return { runIds: [], retried: 0, skipped: skippedIds.length, skippedIds };
    const enqueued = await this.enqueueForAttempts(retryable, actorId, cid);
    return { ...enqueued, skipped: skippedIds.length, skippedIds };
  }

  /** Retry all eligible attempts (bounded sweep, DEAD excluded). */
  async retryAllEligible(storeId?: string, actorId?: string, correlationId?: string, now: Date = new Date()): Promise<RetryEnqueueResult> {
    const cid = resolveCorrelationId(correlationId);
    const rows = (await (this.prisma as any).syncAttempt.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        status: { in: ['PENDING', 'FAILED'] as any },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })) as any[];
    const due = rows.filter((r) => isAttemptEligible(r, now));
    const skippedIds = rows.filter((r) => !isAttemptEligible(r, now)).map((r) => r.id);
    if (due.length === 0) return { runIds: [], retried: 0, skipped: skippedIds.length, skippedIds };
    const enqueued = await this.enqueueForAttempts(due, actorId, cid);
    return { ...enqueued, skipped: skippedIds.length, skippedIds };
  }

  /**
   * Ignore an attempt with a note (audited): marks SKIPPED and appends the
   * note to `errorMessage`. Never resolves ownership (BR-26 — attempts
   * carry no ownership state to resolve).
   */
  async ignoreAttempt(attemptId: string, note?: string): Promise<unknown> {
    const row = await (this.prisma as any).syncAttempt.findUnique({ where: { id: attemptId } });
    if (!row) return null;
    const suffix = note ? ` | ignored by operator: ${note}` : ' | ignored by operator';
    return (this.prisma as any).syncAttempt.update({
      where: { id: attemptId },
      data: { status: 'SKIPPED' as any, errorMessage: `${(row.errorMessage ?? '').slice(0, 1500)}${suffix}`.slice(0, 2000) },
    });
  }

  /**
   * Execute the retry work for one attempt (worker/tests). PRODUCT-family
   * attempts re-run `ProductSyncService.syncProduct` — idempotent by SKU,
   * so a real failure retried here never creates a duplicate remote
   * product. Returns `{ executed, deduped }`.
   */
  async executeRetry(attemptId: string, runId: string): Promise<{ executed: boolean; deduped: boolean }> {
    const attempt = await (this.prisma as any).syncAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.status === 'SUCCESS' || attempt.status === 'SKIPPED') return { executed: false, deduped: false };
    const objectType = attempt.objectType as string;
    const productFamily = ['PRODUCT', 'VARIANT', 'CATEGORY', 'MEDIA', 'PUBLICATION', 'DELETION'].includes(objectType);
    if (productFamily && attempt.storeId && attempt.productId) {
      const products = this.modules.get('ProductSyncService', { strict: false }) as any;
      if (products?.syncProduct) {
        const before = attempt.objectKey as string;
        await products.syncProduct(attempt.storeId, attempt.productId, runId);
        await (this.prisma as any).syncAttempt.update({
          where: { id: attemptId },
          data: { status: 'SUCCESS' as any, errorMessage: `retried ok (run ${runId})` },
        }).catch(() => undefined);
        void before;
        return { executed: true, deduped: true };
      }
    }
    // Non-product attempts (ORDER etc.) re-enter through their queues.
    await this.queues.enqueue(
      'store-reconcile',
      'order-reconcile',
      { runId, storeId: attempt.storeId, requestedDays: 3, wideningReason: `retry attempt ${attemptId}` },
      `order-reconcile-retry-${attemptId}`,
    );
    return { executed: true, deduped: true };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private scopeFor(objectType: string): 'PRODUCT' | 'RECONCILE' {
    return objectType === 'ORDER' ? 'RECONCILE' : 'PRODUCT';
  }

  private async enqueueForAttempts(attempts: any[], actorId: string | undefined, correlationId: string | undefined): Promise<RetryEnqueueResult> {
    // One RETRY run per scope group (PRODUCT vs RECONCILE) for clear history.
    const groups = new Map<string, any[]>();
    for (const a of attempts) {
      const scope = this.scopeFor(a.objectType as string);
      if (!groups.has(scope)) groups.set(scope, []);
      groups.get(scope)?.push(a);
    }
    const runIds: string[] = [];
    for (const [scope, list] of groups) {
      const run = await this.runs.begin({ scope: scope as any, triggerType: 'RETRY', storeId: list[0]?.storeId ?? undefined, initiatedById: actorId, correlationId });
      const runId = (run as any).id as string;
      runIds.push(runId);
      for (const a of list) {
        await this.runs.recordAttempt({
          runId,
          storeId: a.storeId,
          objectType: a.objectType,
          objectKey: a.objectKey,
          productId: a.productId,
          field: a.field,
          status: 'PENDING',
          errorMessage: `retry of attempt ${a.id} (run ${runId})`,
        });
        if (this.scopeFor(a.objectType as string) === 'PRODUCT' && a.storeId && a.productId) {
          await this.queues.enqueue(
            'store-product-sync',
            'store-sync',
            { runId, storeId: a.storeId, productId: a.productId, retryOf: a.id },
            `store-sync-retry-${a.id}-${runId}`.replace(/:/g, '-'),
          );
        } else if (a.storeId) {
          await this.queues.enqueue(
            'store-reconcile',
            'order-reconcile',
            { runId, storeId: a.storeId, requestedDays: 3, wideningReason: `retry attempt ${a.id}` },
            `order-reconcile-retry-${a.id}-${runId}`.replace(/:/g, '-'),
          );
        }
      }
      logSync(this.logger, 'log', `sync-retry: enqueued ${list.length} attempts`, {
        runId,
        storeId: list[0]?.storeId,
        correlationId,
        status: 'PENDING',
        scope,
      });
    }
    return { runIds, retried: attempts.length, skipped: 0, skippedIds: [] };
  }
}
