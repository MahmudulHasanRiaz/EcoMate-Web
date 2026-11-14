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
import { StockStatusSyncService } from './stock-status-sync.service';
import { SyncRunService } from './sync-run.service';
import { SyncRetentionService } from './sync-retention.service';
import { SyncQueuesService, fanoutConcurrency } from './sync-queues.service';
import { StoreCircuitBreaker } from './sync-circuit';
import { StoreOrderIngestService } from '../orders/store-order-ingest.service';
import { StoreOrderReconcileService } from '../orders/store-order-reconcile.service';
import { StoreOrderPushService } from '../orders/store-order-push.service';
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
      // BR-09: permanent EcoMate deletion propagates here (enqueued
      // post-commit by ProductsService.remove — never inline). Mapping
      // cleanup + capability gating live in deleteRemote.
      if (job.name === 'product-delete') {
        if (!productId) return { ignored: job.name };
        return this.products.deleteRemote(storeId, productId);
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
  private readonly logger = new Logger(StoreStockSyncProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly stock: StockStatusSyncService,
    private readonly queues: SyncQueuesService,
  ) { super(); }
  async process(job: Job): Promise<unknown> {
    // P5 owns stock-status sync (§8.4): per-change jobs serialize per store
    // (R-8); the daily audit spans stores and runs unserialized — the
    // monotonic version guard keeps the two paths from racing.
    if (job.name === 'stock-change') {
      const { storeId } = (job.data ?? {}) as { storeId?: string };
      if (!storeId) {
        this.logger.warn('stock-change without storeId — ignored');
        return { ignored: 'missing-storeId' };
      }
      return this.queues.serializeStore(storeId, () =>
        this.stock.handleStockChange((job.data ?? {}) as any),
      );
    }
    if (job.name === 'stock-audit') {
      return this.stock.runAudit((job.data ?? {}) as any);
    }
    // Manual per-store stock-only sweep (store detail "Sync stock" button):
    // evaluates every assigned product (variant fan-out inside), bounded.
    if (job.name === 'stock-store-sweep') {
      const { runId, storeId } = (job.data ?? {}) as { runId?: string; storeId?: string };
      if (!runId || !storeId) {
        this.logger.warn('stock-store-sweep without runId/storeId — ignored');
        return { ignored: 'missing-ids' };
      }
      return this.queues.serializeStore(storeId, () =>
        this.stock.sweepStore(storeId, runId),
      );
    }
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'PRODUCT', status: 'SKIPPED', reason: 'UNKNOWN_STOCK_JOB: ignored (P5 owns stock-status sync)', auditLevel: 'G',
      });
    }
    return { ignored: true };
  }
}

@Processor('store-order-ingest', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreOrderIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(StoreOrderIngestProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly ingest: StoreOrderIngestService,
  ) { super(); }

  /**
   * P6 ingest execution (BR-11/BR-12): webhook + reconcile funnels share one
   * job identity (`store:{storeId}:order:{externalId}`); per-store
   * serialization keeps a store's deliveries ordered (R-8).
   */
  async process(job: Job): Promise<unknown> {
    const { runId, storeId, rawOrder, deliveryKey } = (job.data ?? {}) as {
      runId?: string; storeId?: string; rawOrder?: Record<string, unknown>; deliveryKey?: string;
    };
    if (!storeId || !rawOrder) {
      if (runId) {
        await this.runs.recordItem(runId, {
          objectType: 'ORDER', status: 'SKIPPED', reason: 'ORDER_INGEST_MISSING_PAYLOAD', auditLevel: 'G',
        });
      }
      return { ignored: 'missing-payload' };
    }
    return this.queues.serializeStore(storeId, async () => {
      try {
        const res = await this.ingest.ingest(storeId, rawOrder, {
          type: job.name === 'webhook-order' ? 'WEBHOOK' : 'RECONCILE',
          runId,
          actor: job.name === 'webhook-order' ? 'webhook' : 'reconcile',
        });
        return { ...res, deliveryKey };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`order ingest failed (store ${storeId}): ${msg}`);
        if (runId) {
          await this.runs.recordItem(runId, {
            storeId,
            objectType: 'ORDER',
            status: 'FAILED',
            reason: `ORDER_INGEST_FAILED: ${msg}`,
            auditLevel: 'G',
          });
        }
        await this.runs.upsertIssue({
          storeId,
          code: 'ORDER_INGEST_FAILED',
          objectType: 'ORDER',
          objectKey: `store:${storeId}:ingest:${deliveryKey ?? 'unknown'}`,
          message: `Order ingest failed: ${msg}`,
        });
        throw err;
      }
    });
  }
}

@Processor('store-order-push', { concurrency: 5, limiter: { max: 20, duration: 1000 } })
export class StoreOrderPushProcessor extends WorkerHost {
  private readonly logger = new Logger(StoreOrderPushProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly push: StoreOrderPushService,
  ) { super(); }

  /**
   * P7 status-push execution (§8.6): per-store serialization (R-8); the
   * worker owns idempotency (lastPushedStatus), capability gating,
   * read-back verification and the standard retry ladder. Unknown job
   * names are an explicit skip, never silent.
   */
  async process(job: Job): Promise<unknown> {
    if (job.name === 'order-status-push') {
      const { storeId } = (job.data ?? {}) as { storeId?: string };
      if (!storeId) {
        this.logger.warn('order-status-push without storeId — ignored');
        return { ignored: 'missing-storeId' };
      }
      return this.queues.serializeStore(storeId, () =>
        this.push.handlePush((job.data ?? {}) as any),
      );
    }
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'ORDER', status: 'SKIPPED', reason: `UNKNOWN_PUSH_JOB:${job.name}: ignored`, auditLevel: 'G',
      });
    }
    return { ignored: job.name };
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
    private readonly orderReconcile: StoreOrderReconcileService,
  ) { super(); }
  async process(job: Job): Promise<unknown> {
    // P6 order reconcile (BR-10/BR-11): hourly tick fans out per-store bounded
    // runs; manual triggers land here with the same bounds.
    if (job.name === 'order-reconcile-tick') {
      return this.orderReconcile.tickHourly();
    }
    if (job.name === 'order-reconcile') {
      const { runId, storeId, requestedDays, wideningReason } = job.data as {
        runId: string; storeId: string; requestedDays?: number; wideningReason?: string;
      };
      return this.queues.serializeStore(storeId, () =>
        this.orderReconcile.runStore(storeId, runId, { requestedDays, wideningReason }),
      );
    }
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
  private readonly logger = new Logger(StoreMaintenanceProcessor.name);
  constructor(
    private readonly runs: SyncRunService,
    private readonly retention: SyncRetentionService,
  ) { super(); }
  async process(job: Job): Promise<unknown> {
    // P11 BR-19: daily bounded retention purge (additive; the queue bounds
    // predate P11). Heavy work runs here, never in the HTTP request (BR-21).
    if (job.name === 'retention-purge') {
      return this.retention.purge(new Date());
    }
    const { runId } = (job.data ?? {}) as { runId?: string };
    if (runId) {
      await this.runs.recordItem(runId, {
        objectType: 'PRODUCT', status: 'SKIPPED', reason: 'UNKNOWN_MAINTENANCE_JOB: ignored', auditLevel: 'G',
      });
    }
    return { ignored: job.name };
  }
}
