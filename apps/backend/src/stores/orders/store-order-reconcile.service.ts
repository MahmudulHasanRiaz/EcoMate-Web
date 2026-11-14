/**
 * Store order reconcile — central-commerce P6 (§8.5, BR-10/BR-11).
 *
 * Hourly BullMQ repeatable per connected non-NATIVE store:
 * `fetchOrders({ since: now − windowDays, until: now })`, paginated and
 * bounded (BR-10). Every order funnels through the SAME job identity as the
 * webhook path (StoreOrderIngestService.ingest) so the two paths cannot
 * double-work (BR-11/BR-12).
 *
 * Widening is opt-in, failure-driven, bounded (hard max 30 days), page-capped,
 * rate-limited and recorded on the run (`windowDays`, `wideningReason`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncRunService } from '../sync/sync-run.service';
import { SyncQueuesService } from '../sync/sync-queues.service';
import { StoreOrderIngestService } from './store-order-ingest.service';
import { StoresService } from '../stores.service';
import {
  clampReconcileWindow,
  RECONCILE_MAX_PAGES,
  RECONCILE_PAGE_SIZE,
} from './normalize-order';
import { reconcileEnabled, reconcileWideningEnabled } from '../store-flags';

export interface ReconcileOptions {
  requestedDays?: number;
  wideningReason?: string;
  actor?: string;
}

@Injectable()
export class StoreOrderReconcileService {
  private readonly logger = new Logger(StoreOrderReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    private readonly ingest: StoreOrderIngestService,
    private readonly stores: StoresService,
  ) {}

  /**
   * Hourly tick: enqueue one bounded reconcile job per connected external
   * store. Heavy work never runs in the caller (BR-21).
   */
  async tickHourly(): Promise<{ enqueued: string[]; excludedNativeCount: number }> {
    if (!reconcileEnabled()) return { enqueued: [], excludedNativeCount: 0 };
    const stores = await this.prisma.store.findMany({
      where: { status: 'CONNECTED' as any, autoSyncEnabled: true },
      select: { id: true, kind: true },
    });
    const external = (stores as any[]).filter((s) => s.kind !== 'NATIVE');
    const enqueued: string[] = [];
    for (const store of external) {
      const run = await this.runs.begin({
        scope: 'RECONCILE' as any,
        triggerType: 'SCHEDULED',
        storeId: store.id,
        windowDays: 3,
      });
      const runId = (run as any).id as string;
      await this.queues.enqueue(
        'store-reconcile',
        'order-reconcile',
        { runId, storeId: store.id },
        `order-reconcile:${store.id}:${runId}`,
      );
      enqueued.push(runId);
    }
    return { enqueued, excludedNativeCount: (stores as any[]).length - external.length };
  }

  /**
   * Run one bounded reconcile for a store. Returns run summary; never throws
   * for provider failures (records FAILED + issue instead).
   */
  async runStore(
    storeId: string,
    runId: string,
    opts: ReconcileOptions = {},
  ): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
    const { windowDays, wideningReason } = clampReconcileWindow({
      requestedDays: opts.requestedDays,
      wideningReason: opts.wideningReason,
      wideningEnabled: reconcileWideningEnabled(),
    });
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: { windowDays, wideningReason },
    });

    const until = new Date();
    const since = new Date(until.getTime() - windowDays * 86400000);
    const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };

    let provider: Awaited<ReturnType<StoreOrderIngestService['providerFor']>>;
    let withSecrets: { id: string; kind: string; settings?: any; secrets?: any };
    try {
      withSecrets = (await this.stores.storeWithSecrets(storeId)) as any;
      provider = await this.ingest.providerFor(storeId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.runs.upsertIssue({
        storeId,
        code: 'ORDER_RECONCILE_FAILED',
        objectType: 'ORDER',
        objectKey: `store:${storeId}:reconcile`,
        message: `Reconcile cannot start: ${msg}`,
      });
      // Widening is failure-driven (BR-10): a hard provider failure is the
      // signal the operator may widen on — recorded, never automatic.
      if ((windowDays >= 30 || !reconcileWideningEnabled()) && /auth|permission/i.test(msg)) {
        await this.runs.upsertIssue({
          storeId,
          code: 'ORDER_RECONCILE_AT_LIMIT',
          objectType: 'ORDER',
          objectKey: `store:${storeId}:reconcile:limit`,
          message: `Reconcile failing at the widening bound — operator review required (BR-10).`,
        });
      }
      await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
      return { ...counts, failed: 1 };
    }

    let page = 1;
    let pages = 0;
    let cursor: string | undefined;
    try {
      for (;;) {
        pages += 1;
        if (pages > RECONCILE_MAX_PAGES) {
          await this.runs.recordItem(runId, {
            storeId,
            objectType: 'ORDER',
            status: 'SKIPPED',
            reason: `RECONCILE_PAGE_CAP: stopped after ${RECONCILE_MAX_PAGES} pages (BR-10 bound)`,
            auditLevel: 'G',
          });
          break;
        }
        // Rate-limited paging: small delay between pages, bounded page size.
        // Cursor-threaded: page-based providers use `page`, cursor providers
        // (Shopify page_info) use `nextCursor` — both bounded by the cap.
        if (page > 1) await new Promise((r) => setTimeout(r, 400));
        const { orders, hasMore, nextCursor } = await provider.fetchOrders(withSecrets as any, {
          since,
          until,
          page,
          pageSize: RECONCILE_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        for (const raw of orders as Record<string, unknown>[]) {
          try {
            const res = await this.ingest.ingest(storeId, raw, {
              type: 'RECONCILE',
              runId,
              actor: opts.actor ?? 'reconcile',
            });
            if (res.created) counts.created += 1;
            else if (res.statusChanged) counts.updated += 1;
            else counts.skipped += 1;
          } catch (err) {
            counts.failed += 1;
            const msg = err instanceof Error ? err.message : String(err);
            await this.runs.recordItem(runId, {
              storeId,
              objectType: 'ORDER',
              status: 'FAILED',
              reason: `RECONCILE_ITEM_FAILED: ${msg}`,
              auditLevel: 'G',
            });
          }
        }
        if (!hasMore) break;
        cursor = nextCursor;
        page += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      counts.failed += 1;
      await this.runs.upsertIssue({
        storeId,
        code: 'ORDER_RECONCILE_FAILED',
        objectType: 'ORDER',
        objectKey: `store:${storeId}:reconcile`,
        message: `Reconcile failed: ${msg}`,
      });
    }

    await this.runs.finish(runId, counts);
    return counts;
  }
}
