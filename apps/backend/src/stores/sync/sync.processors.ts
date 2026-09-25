/**
 * In-process sync processors — central-commerce §8.1 (P4).
 *
 * One processor per queue (explicit concurrency + limiter, R-8), bounded
 * fan-out, per-store serialization, circuit-breaker gate with half-open
 * probe. Single-instance deployment: no separate worker process (§4.2).
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductSyncService, SYNC_FANOUT_CONCURRENCY_DEFAULT } from './product-sync.service';
import { SyncRunService } from './sync-run.service';
import { SyncQueuesService, fanoutConcurrency } from './sync-queues.service';
import { StoreCircuitBreaker } from './sync-circuit';
import { classifyProviderError, MAX_SYNC_ATTEMPTS, RETRY_BACKOFF_MS } from '../providers/retry-classifier';

async function boundedMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

@Processor('store-product-sync', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreProductSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(StoreProductSyncProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductSyncService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly breaker: StoreCircuitBreaker,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'sync-all') return this.fanOut(job);
    const { runId, storeId, productId } = job.data as { runId: string; storeId: string; productId?: string };
    return this.queues.serializeStore(storeId, async () => {
      if (!this.breaker.allow(storeId)) {
        this.logger.warn(`breaker open for ${storeId} — requeueing probe`);
        throw new Error(`circuit-open:${storeId}`);
      }
      try {
        const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
        if (productId) {
          const r = await this.products.syncProduct(storeId, productId, runId);
          counts.updated += r.pushed.length;
          counts.skipped += r.skipped.length;
        } else {
          // Store sweep: assigned + globally active products, bounded.
          const assignments = await (this.prisma as any).productStoreAssignment.findMany({
            where: { storeId }, select: { productId: true }, take: 500,
          });
          const ids = assignments.map((a: any) => a.productId);
          const limit = fanoutConcurrency();
          const results = await boundedMap(ids, limit, async (pid: string) => {
            try {
              return await this.products.syncProduct(storeId, pid, runId);
            } catch (err) {
              const decision = classifyProviderError(err);
              await this.runs.recordAttempt({
                runId, storeId, objectType: 'PRODUCT', objectKey: `store:${storeId}:product:${pid}`,
                productId: pid, status: 'FAILED', errorCategory: String(decision.category),
                errorMessage: err instanceof Error ? err.message : String(err),
              });
              // BR-26: a failure NEVER resolves ownership — no state writes here.
              counts.failed += 1;
              return null;
            }
          });
          for (const r of results) {
            if (!r) continue;
            counts.updated += r.pushed.length;
            counts.skipped += r.skipped.length;
          }
        }
        this.breaker.success(storeId);
        await this.runs.finish(runId, { created: counts.created, updated: counts.updated, skipped: counts.skipped, failed: counts.failed });
        return counts;
      } catch (err) {
        this.breaker.failure(storeId);
        // §8.1 retry ladder (30s→6h, 5 attempts → DEAD + issue). BullMQ
        // attempts are 1 — the engine owns retries so classification stays
        // pure and permanent failures never loop. BR-26: failures never
        // resolve ownership — only attempt/issue rows are written here.
        const decision = classifyProviderError(err);
        const objectKey = productId ? `store:${storeId}:product:${productId}` : `store:${storeId}:sweep`;
        const prior = await this.runs.countAttempts(storeId, objectKey);
        const attemptNo = prior + 1;
        const nextRetryAt = !decision.retryable || attemptNo >= MAX_SYNC_ATTEMPTS
          ? undefined
          : new Date(Date.now() + RETRY_BACKOFF_MS[Math.min(attemptNo - 1, RETRY_BACKOFF_MS.length - 1)]);
        await this.runs.recordAttempt({
          runId, storeId, objectType: 'PRODUCT', objectKey, productId,
          attemptNo, status: nextRetryAt ? 'PENDING' : 'DEAD',
          errorCategory: String(decision.category),
          errorMessage: err instanceof Error ? err.message : String(err),
          nextRetryAt,
        });
        if (!nextRetryAt) {
          await this.runs.upsertIssue({
            storeId, code: 'DEAD_LETTER', objectType: 'PRODUCT', objectKey, productId,
            message: `Sync dead after ${attemptNo} attempts (${decision.category}): ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
        throw err;
      }
    });
  }

  private async fanOut(job: Job): Promise<unknown> {
    const { batchRunId, scope } = job.data as { batchRunId: string; scope: string };
    const stores = await this.prisma.store.findMany({ where: { status: { not: 'DISCONNECTED' as any } } });
    const external = (stores as any[]).filter((s) => s.kind !== 'NATIVE');
    const excludedNativeCount = (stores as any[]).length - external.length;
    const limit = fanoutConcurrency() || SYNC_FANOUT_CONCURRENCY_DEFAULT;
    const childRunIds: string[] = [];
    await boundedMap(external, limit, async (store: any) => {
      const child = await this.runs.begin({ scope: (scope as any) ?? 'PRODUCT', triggerType: 'MANUAL', storeId: store.id });
      childRunIds.push((child as any).id);
      await this.queues.enqueue('store-product-sync', 'store-sync', { runId: (child as any).id, storeId: store.id }, `store-sync:${(child as any).id}`);
    });
    await this.runs.finish(batchRunId, { created: childRunIds.length, updated: 0, skipped: excludedNativeCount, failed: 0 });
    return { batchRunId, childRunIds, excludedNativeCount };
  }
}

@Processor('store-stock-sync', { concurrency: 10, limiter: { max: 30, duration: 1000 } })
export class StoreStockSyncProcessor extends WorkerHost {
  constructor(private readonly runs: SyncRunService) { super(); }
  async process(job: Job): Promise<unknown> {
    // P5 owns stock-status sync: P4 registers the queue + bounds so the
    // name exists and work enqueued today is parked, never dropped.
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'PRODUCT', status: 'SKIPPED', reason: 'STOCK_SYNC_DEFERRED_TO_P5', auditLevel: 'G',
      });
    }
    return { deferred: 'P5' };
  }
}

@Processor('store-order-ingest', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreOrderIngestProcessor extends WorkerHost {
  constructor(private readonly runs: SyncRunService) { super(); }
  async process(job: Job): Promise<unknown> {
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'ORDER', status: 'SKIPPED', reason: 'ORDER_INGEST_DEFERRED_TO_P6', auditLevel: 'G',
      });
    }
    return { deferred: 'P6' };
  }
}

@Processor('store-order-push', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreOrderPushProcessor extends WorkerHost {
  constructor(private readonly runs: SyncRunService) { super(); }
  async process(job: Job): Promise<unknown> {
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'ORDER', status: 'SKIPPED', reason: 'ORDER_PUSH_DEFERRED_TO_P7', auditLevel: 'G',
      });
    }
    return { deferred: 'P7' };
  }
}

@Processor('store-reconcile', { concurrency: 2, limiter: { max: 5, duration: 1000 } })
export class StoreReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(StoreReconcileProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductSyncService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
  ) { super(); }
  async process(job: Job): Promise<unknown> {
    // Hourly product safety-net: re-run the ownership engine over assigned
    // products (bounded 3-day window semantics land with order reconcile in
    // P6; product re-verification here never resolves — BR-26).
    const { runId, storeId, windowDays, wideningReason } = job.data as {
      runId: string; storeId: string; windowDays?: number; wideningReason?: string;
    };
    void windowDays; void wideningReason;
    return this.queues.serializeStore(storeId, async () => {
      const assignments = await (this.prisma as any).productStoreAssignment.findMany({
        where: { storeId }, select: { productId: true }, take: 200,
      });
      let failed = 0;
      let updated = 0;
      for (const a of assignments as any[]) {
        try {
          const r = await this.products.syncProduct(storeId, a.productId, runId);
          updated += r.pushed.length;
        } catch (err) {
          failed += 1;
          this.logger.warn(`reconcile item failed (no resolution): ${err}`);
        }
      }
      await this.runs.finish(runId, { created: 0, updated, failed });
      return { updated, failed };
    });
  }
}

@Processor('store-maintenance', { concurrency: 1, limiter: { max: 2, duration: 1000 } })
export class StoreMaintenanceProcessor extends WorkerHost {
  constructor(private readonly runs: SyncRunService) { super(); }
  async process(job: Job): Promise<unknown> {
    // Retention lifecycle lands in P11; the queue exists with bounds now.
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'PRODUCT', status: 'SKIPPED', reason: 'RETENTION_DEFERRED_TO_P11', auditLevel: 'G',
      });
    }
    return { deferred: 'P11' };
  }
}
