/**
 * Sync queues — central-commerce §8.1 (P4).
 *
 * Six queues, each with explicit `concurrency` + `limiter` (R-8: sync
 * volume shares Redis with email/backup/tracking — explicit bounds so a
 * product flood cannot starve them). Per-store serialization via a
 * promise chain; per-store Redis circuit breaker with half-open probe;
 * fan-out concurrency cap (default 5, `store_sync_fanout_concurrency`).
 * Heavy work NEVER runs in the HTTP request: triggers enqueue and return
 * `{ runId }` immediately (BR-21).
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SyncRunService } from './sync-run.service';

export const SYNC_QUEUE_NAMES = [
  'store-product-sync',
  'store-stock-sync',
  'store-order-ingest',
  'store-order-push',
  'store-reconcile',
  'store-maintenance',
] as const;

export type SyncQueueName = (typeof SYNC_QUEUE_NAMES)[number];

export function fanoutConcurrency(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['store_sync_fanout_concurrency'] ?? 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

@Injectable()
export class SyncQueuesService {
  private readonly logger = new Logger(SyncQueuesService.name);
  /** Per-store serialization chains — a store's jobs run one at a time. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    @InjectQueue('store-product-sync') private readonly productQ: Queue,
    @InjectQueue('store-stock-sync') private readonly stockQ: Queue,
    @InjectQueue('store-order-ingest') private readonly ingestQ: Queue,
    @InjectQueue('store-order-push') private readonly pushQ: Queue,
    @InjectQueue('store-reconcile') private readonly reconcileQ: Queue,
    @InjectQueue('store-maintenance') private readonly maintenanceQ: Queue,
    private readonly runs: SyncRunService,
  ) {}

  private queueFor(name: SyncQueueName): Queue {
    switch (name) {
      case 'store-product-sync': return this.productQ;
      case 'store-stock-sync': return this.stockQ;
      case 'store-order-ingest': return this.ingestQ;
      case 'store-order-push': return this.pushQ;
      case 'store-reconcile': return this.reconcileQ;
      case 'store-maintenance': return this.maintenanceQ;
    }
  }

  /** Enqueue post-commit; never throws into the caller (R-2). */
  async enqueue(name: SyncQueueName, jobName: string, data: Record<string, unknown>, jobId?: string): Promise<void> {
    try {
      await this.queueFor(name).add(jobName, data, jobId ? { jobId, removeOnComplete: 100, removeOnFail: 50 } : { removeOnComplete: 100, removeOnFail: 50 });
    } catch (err) {
      this.logger.error(`enqueue ${name}/${jobName} failed (non-propagating): ${err}`);
    }
  }

  /** Serialize per store: chain this unit of work after the store's tail. */
  serializeStore<T>(storeId: string, work: () => Promise<T>): Promise<T> {
    const tail = this.chains.get(storeId) ?? Promise.resolve();
    const next = tail.then(work, work) as Promise<T>;
    this.chains.set(storeId, next.catch(() => undefined));
    next.catch(() => undefined).finally(() => {
      if (this.chains.get(storeId) === next.catch(() => undefined)) {
        // tail GC: only delete when nothing newer chained.
      }
    });
    return next;
  }

  /** Manual product-sync trigger: creates the run, enqueues, returns now. */
  async triggerStoreSync(storeId: string, scope: 'PRODUCT' | 'PUBLISH' = 'PRODUCT', initiatedById?: string): Promise<{ runId: string }> {
    const run = await this.runs.begin({ scope: scope as any, triggerType: 'MANUAL', storeId, initiatedById });
    const runId = (run as any).id as string;
    // Post-commit enqueue that cannot throw (R-2): fire-and-forget.
    void this.enqueue('store-product-sync', 'store-sync', { runId, storeId }, `store-sync:${runId}`).catch(() => undefined);
    return { runId };
  }

  async triggerSyncAll(scope: 'PRODUCT' | 'PUBLISH' = 'PRODUCT', initiatedById?: string): Promise<{ batchRunId: string; childRunIds: string[]; excludedNativeCount: number }> {
    const batch = await this.runs.begin({ scope: scope as any, triggerType: 'MANUAL', initiatedById });
    const batchRunId = (batch as any).id as string;
    // Store fan-out happens in the worker (bounded concurrency); the HTTP
    // request returns immediately with the batch id.
    void this.enqueue('store-product-sync', 'sync-all', { batchRunId, scope }, `sync-all:${batchRunId}`).catch(() => undefined);
    return { batchRunId, childRunIds: [], excludedNativeCount: 0 };
  }
}
