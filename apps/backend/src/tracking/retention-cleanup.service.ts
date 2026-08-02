import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingNormalizer } from './tracking.normalizer';
import { SCHEMA_VERSION } from './tracking.constants';
import { TrackingSnapshotPayload } from './tracking-snapshot.types';

/** Rows touched per loop iteration — keeps each write short and lock-scalable. */
const BATCH_SIZE = 1000;

/** Retention windows (design §12). Raw PII is bound to 90 days; replay archives 2 years. */
const RETENTION_ANONYMIZE_DAYS = 90; // context identifiers + snapshot payloads
const RETENTION_OUTBOX_DAYS = 30; // terminal outboxes + their dispatch events
const RETENTION_DISPATCH_DAYS = 365; // dispatch + dispatch-event audit rows
const RETENTION_ARCHIVE_DAYS = 730; // snapshots → replay archive, then purge

/** Cadence of the scheduled sweep (matches the other tracking schedulers). */
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

const TERMINAL_OUTBOX_STATUS = ['SENT', 'DEAD'] as const;

export interface RetentionCleanupSummary {
  contextsAnonymized: number;
  payloadsNulled: number;
  terminalOutboxesPurged: number;
  dispatchesPurged: number;
  dispatchEventsPurged: number;
  snapshotsArchived: number;
  snapshotsPurged: number;
}

/** Aggregated outcome of `archiveAndPurgeSnapshots` for a sweep. */
interface ArchivePurgeResult {
  snapshotsArchived: number;
  snapshotsPurged: number;
}

const EMPTY_SUMMARY: RetentionCleanupSummary = {
  contextsAnonymized: 0,
  payloadsNulled: 0,
  terminalOutboxesPurged: 0,
  dispatchesPurged: 0,
  dispatchEventsPurged: 0,
  snapshotsArchived: 0,
  snapshotsPurged: 0,
};

/**
 * RetentionCleanupService (design §12) — the scheduled, batched retention and
 * anonymization substrate that bounds how long raw PII lives in the tracking
 * store while preserving what a 2-year replay needs:
 *
 *  1. `anonymizeContexts`   — 90d: wipe identifiers/ip/ua/url/referrer, keep
 *                             ctxId/externalId/timestamps.
 *  2. `nullSnapshotPayloads`— 90d: drop the raw payload from old snapshots
 *                             (envelope eventId/eventType/eventTime stays).
 *  3. `purgeTerminalOutboxes`— 30d: delete SENT/DEAD outboxes + their
 *                             dispatch events.
 *  4. `purgeOldDispatches`  — 1y: delete dispatch + dispatch-event audit rows.
 *  5. `archiveAndPurgeSnapshots` — 2y: for not-yet-archived snapshots, write a
 *                             PII-stripped `TrackingReplayArchive` (email/phone
 *                             → SHA-256 hashes) when the outbox reached a
 *                             terminal state, then delete the snapshot + its
 *                             outbox + dispatch rows in one short transaction.
 *
 * Every job walks its table in id-ascending cursor pages of 1000, re-applying
 * the full predicate on the write so a row that changed between read and write
 * is never touched twice. `RETENTION_ENABLED=false` disables the whole sweep
 * (default: enabled). `OnModuleInit` runs one sweep at boot, then every 6h.
 */
@Injectable()
export class RetentionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionCleanupService.name);
  private readonly normalizer = new TrackingNormalizer();
  private readonly enabled: boolean;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // Env vars are strings; treat only an explicit 'false' as disabled.
    this.enabled =
      String(config.get<string>('RETENTION_ENABLED') ?? 'true').toLowerCase() !==
      'false';
  }

  /** Run every job in sequence, in PK-batched loops. `now` is injectable for tests. */
  async runCleanup(now = new Date()): Promise<RetentionCleanupSummary> {
    if (!this.enabled) {
      this.logger.warn('Retention cleanup skipped: RETENTION_ENABLED=false');
      return { ...EMPTY_SUMMARY };
    }
    const started = Date.now();
    const summary: RetentionCleanupSummary = {
      contextsAnonymized: await this.anonymizeContexts(now),
      payloadsNulled: await this.nullSnapshotPayloads(now),
      terminalOutboxesPurged: await this.purgeTerminalOutboxes(now),
      ...(await this.purgeOldDispatches(now)),
      ...(await this.archiveAndPurgeSnapshots(now)),
    };
    this.logger.log(
      `Retention cleanup finished in ${Date.now() - started}ms: ${JSON.stringify(summary)}`,
    );
    return summary;
  }

  /**
   * 90d — wipe PII columns from stale contexts while keeping the identity keys
   * (ctxId/externalId) and timestamps that joins and funnels still need.
   */
  async anonymizeContexts(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_ANONYMIZE_DAYS * 86_400_000);
    let total = 0;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.trackingContext.findMany({
        where: { lastSeenAt: { lt: cutoff }, identifiers: { not: {} } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);
      const res = await this.prisma.trackingContext.updateMany({
        where: {
          id: { in: ids },
          lastSeenAt: { lt: cutoff },
          identifiers: { not: {} },
        },
        data: {
          identifiers: {},
          ip: null,
          userAgent: null,
          url: null,
          referrer: null,
        },
      });
      total += res.count;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return total;
  }

  /**
   * 90d — drop the raw payload from old snapshots. The envelope
   * (eventId/eventType/eventTime/orderId/ctxId) survives for joins and the
   * 2-year archive pass. `Prisma.JsonNull` (not SQL NULL) is stored because the
   * column is NOT NULL; the predicate re-checks JSON-null so an already-nulled
   * row is not visited twice.
   */
  async nullSnapshotPayloads(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_ANONYMIZE_DAYS * 86_400_000);
    let total = 0;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.trackingSnapshot.findMany({
        where: { createdAt: { lt: cutoff }, payload: { not: Prisma.JsonNull } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);
      const res = await this.prisma.trackingSnapshot.updateMany({
        where: {
          id: { in: ids },
          createdAt: { lt: cutoff },
          payload: { not: Prisma.JsonNull },
        },
        data: { payload: Prisma.JsonNull },
      });
      total += res.count;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return total;
  }

  /**
   * 30d — delete terminal (SENT/DEAD) outboxes dispatched more than 30 days ago
   * and the dispatch events that reference their snapshotIds. Non-terminal rows
   * (PENDING/CLAIMED/FAILED) are left for the reconciler/replay machinery.
   */
  async purgeTerminalOutboxes(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_OUTBOX_DAYS * 86_400_000);
    let total = 0;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.trackingOutbox.findMany({
        where: { status: { in: [...TERMINAL_OUTBOX_STATUS] }, dispatchedAt: { lt: cutoff } },
        select: { id: true, snapshotId: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);
      const snapshotIds = [...new Set(rows.map((r) => r.snapshotId))];
      const res = await this.prisma.trackingOutbox.deleteMany({
        where: {
          id: { in: ids },
          status: { in: [...TERMINAL_OUTBOX_STATUS] },
          dispatchedAt: { lt: cutoff },
        },
      });
      await this.prisma.trackingDispatchEvent.deleteMany({
        where: { snapshotId: { in: snapshotIds } },
      });
      total += res.count;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return total;
  }

  /** 1y — delete dispatch + dispatch-event audit rows older than a year. */
  async purgeOldDispatches(
    now = new Date(),
  ): Promise<Pick<RetentionCleanupSummary, 'dispatchesPurged' | 'dispatchEventsPurged'>> {
    const cutoff = new Date(now.getTime() - RETENTION_DISPATCH_DAYS * 86_400_000);
    const dispatchesPurged = await this.purgeModelById(
      (cursor) =>
        this.prisma.trackingDispatch.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (ids) =>
        this.prisma.trackingDispatch.deleteMany({
          where: { id: { in: ids }, createdAt: { lt: cutoff } },
        }),
    );
    const dispatchEventsPurged = await this.purgeModelById(
      (cursor) =>
        this.prisma.trackingDispatchEvent.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (ids) =>
        this.prisma.trackingDispatchEvent.deleteMany({
          where: { id: { in: ids }, createdAt: { lt: cutoff } },
        }),
    );
    return { dispatchesPurged, dispatchEventsPurged };
  }

  /**
   * 2y — archive-then-purge: for not-yet-archived snapshots write a PII-stripped
   * `TrackingReplayArchive` (configSnapshot from the outbox, versions rebuilt
   * from the dispatch rows) when the outbox reached a terminal state, then — in
   * one short transaction, archive first — delete the snapshot, its outbox, its
   * dispatch rows and their dispatch events. An already-anonymized snapshot
   * (payload JSON-null) is archived with the null payload; its envelope fields
   * are preserved so replay still knows what the event was.
   */
  async archiveAndPurgeSnapshots(now = new Date()): Promise<ArchivePurgeResult> {
    const cutoff = new Date(now.getTime() - RETENTION_ARCHIVE_DAYS * 86_400_000);
    let snapshotsArchived = 0;
    let snapshotsPurged = 0;
    let cursor: string | undefined;
    while (true) {
      const idsRows = await this.prisma.trackingSnapshot.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (idsRows.length === 0) break;
      const batchIds = idsRows.map((r) => r.id);

      // A snapshot already carrying a ReplayArchive must not be re-archived.
      const existing = await this.prisma.trackingReplayArchive.findMany({
        where: { snapshotId: { in: batchIds } },
        select: { snapshotId: true },
      });
      const existingSet = new Set(existing.map((a) => a.snapshotId));
      const unarchivedIds = batchIds.filter((id) => !existingSet.has(id));

      if (unarchivedIds.length > 0) {
        const [snapshots, outboxes, dispatches] = await Promise.all([
          this.prisma.trackingSnapshot.findMany({
            where: { id: { in: unarchivedIds } },
          }),
          this.prisma.trackingOutbox.findMany({
            where: { snapshotId: { in: unarchivedIds } },
          }),
          this.prisma.trackingDispatch.findMany({
            where: { snapshotId: { in: unarchivedIds } },
            select: {
              snapshotId: true,
              provider: true,
              adapterVersion: true,
              providerApiVersion: true,
              payloadVersion: true,
              normalizerVersion: true,
            },
          }),
        ]);
        const outboxBySnapshot = new Map(outboxes.map((o) => [o.snapshotId, o]));
        const dispatchesBySnapshot = new Map<
          string,
          Array<{
            provider: string;
            adapterVersion: number | null;
            providerApiVersion: string | null;
          }>
        >();
        for (const d of dispatches) {
          const list = dispatchesBySnapshot.get(d.snapshotId) ?? [];
          list.push({
            provider: d.provider,
            adapterVersion: d.adapterVersion,
            providerApiVersion: d.providerApiVersion,
          });
          dispatchesBySnapshot.set(d.snapshotId, list);
        }

        // Archive only when the outbox reached a terminal state (replay-worthy);
        // non-terminal 2y-old snapshots are still purged.
        const archiveRows: Prisma.TrackingReplayArchiveCreateManyInput[] = [];
        for (const snap of snapshots) {
          const status = outboxBySnapshot.get(snap.id)?.status ?? null;
          if (status !== 'SENT' && status !== 'DEAD') continue;
          const payload = snap.payload as TrackingSnapshotPayload | null;
          archiveRows.push({
            snapshotId: snap.id,
            eventId: snap.eventId,
            eventType: snap.eventType,
            eventTime: snap.eventTime,
            archivedPayload:
              payload == null
                ? Prisma.JsonNull
                : (this.stripPii(payload) as unknown as Prisma.InputJsonValue),
            configSnapshot:
              (outboxBySnapshot.get(snap.id)?.configSnapshot ??
                {}) as Prisma.InputJsonValue,
            versions:
              (this.buildVersions(
                dispatchesBySnapshot.get(snap.id) ?? [],
              ) as Prisma.InputJsonValue),
          });
        }

        const ops: Prisma.PrismaPromise<unknown>[] = [];
        if (archiveRows.length > 0) {
          ops.push(
            this.prisma.trackingReplayArchive.createMany({
              data: archiveRows,
              skipDuplicates: true, // a concurrent DEAD-time archive write wins
            }),
          );
        }
        ops.push(
          this.prisma.trackingOutbox.deleteMany({
            where: { snapshotId: { in: unarchivedIds } },
          }),
        );
        ops.push(
          this.prisma.trackingDispatch.deleteMany({
            where: { snapshotId: { in: unarchivedIds } },
          }),
        );
        ops.push(
          this.prisma.trackingDispatchEvent.deleteMany({
            where: { snapshotId: { in: unarchivedIds } },
          }),
        );
        ops.push(
          this.prisma.trackingSnapshot.deleteMany({
            where: { id: { in: unarchivedIds } },
          }),
        );
        await this.prisma.$transaction(ops);

        snapshotsArchived += archiveRows.length;
        snapshotsPurged += unarchivedIds.length;
      }

      if (idsRows.length < BATCH_SIZE) break;
      cursor = idsRows[idsRows.length - 1].id;
    }
    return { snapshotsArchived, snapshotsPurged };
  }

  /** Start the 6h sweep loop (no-op when disabled or already running). */
  async start(): Promise<void> {
    if (this.timer || !this.enabled) return;
    this.timer = setInterval(() => {
      void this.runCleanup().catch((err) =>
        this.logger.error(`Retention cleanup iteration failed: ${err}`),
      );
    }, RUN_INTERVAL_MS);
    this.logger.log(
      `Tracking retention cleanup started (every ${RUN_INTERVAL_MS}ms)`,
    );
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.start();
    if (this.enabled) {
      await this.runCleanup().catch((err) =>
        this.logger.error(`Retention cleanup at boot failed: ${err}`),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * Shared id-cursor batched purge used by the 1y dispatch cleanup. Kept
   * minimal here because the other jobs differ in their read/write shapes.
   */
  private async purgeModelById(
    readPage: (cursor?: string) => Promise<Array<{ id: string }>>,
    deleteBatch: (ids: string[]) => Promise<{ count: number }>,
  ): Promise<number> {
    let total = 0;
    let cursor: string | undefined;
    while (true) {
      const rows = await readPage(cursor);
      if (rows.length === 0) break;
      const res = await deleteBatch(rows.map((r) => r.id));
      total += res.count;
      if (rows.length < BATCH_SIZE) break;
      cursor = rows[rows.length - 1].id;
    }
    return total;
  }

  /**
   * Rebuild the archive `versions` from the snapshot's dispatch rows, mirroring
   * the dispatcher's buildVersions shape (§4.10) so replay can still pin each
   * provider's adapter against what it ran under.
   */
  private buildVersions(
    dispatches: Array<{
      provider: string;
      adapterVersion: number | null;
      providerApiVersion: string | null;
    }>,
  ): Record<string, unknown> {
    const providers: Record<string, { adapterVersion: number | null; providerApiVersion: string | null }> =
      {};
    for (const d of dispatches) {
      if (d.adapterVersion != null || d.providerApiVersion != null) {
        providers[d.provider] = {
          adapterVersion: d.adapterVersion,
          providerApiVersion: d.providerApiVersion,
        };
      }
    }
    const first = dispatches[0];
    return {
      schemaVersion: SCHEMA_VERSION,
      payloadVersion: SCHEMA_VERSION,
      normalizerVersion: this.normalizer.version,
      adapterVersion: first?.adapterVersion ?? null,
      providerApiVersion: first?.providerApiVersion ?? null,
      providers,
    };
  }

  /**
   * PII-stripping for the archived payload (privacy §12) — mirrors
   * ReplayService: customer email/phone become SHA-256 hashes via the
   * normalizer; a value that cannot be hashed (synthetic email, unresolved
   * bare-local phone) is dropped rather than archived raw.
   */
  private stripPii(payload: TrackingSnapshotPayload): Record<string, unknown> {
    const out: Record<string, unknown> = { ...payload };
    if (payload.customer && typeof payload.customer === 'object') {
      const customer: Record<string, unknown> = { ...payload.customer };
      if (customer.email) {
        const hash = this.normalizer.hashEmail(customer.email as string);
        if (hash) customer.email = hash;
        else delete customer.email;
      }
      if (customer.phone) {
        const hash = this.normalizer.hashPhone(
          customer.phone as string,
          (customer.country as string) || undefined,
        );
        if (hash) customer.phone = hash;
        else delete customer.phone;
      }
      out.customer = customer;
    }
    return out;
  }
}
