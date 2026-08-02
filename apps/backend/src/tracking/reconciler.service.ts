import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getRetryBackoffMs } from './outbox-relay.service';

/** Interval between reconcile sweeps when started. */
const RECONCILE_INTERVAL_MS = 60_000;

/** A CLAIMED outbox older than this (no dispatch progress) is considered stuck. */
const STALE_CLAIM_THRESHOLD_MS = 10 * 60_000;

/** A SENDING dispatch row untouched for longer than this is considered hung. */
const HUNG_SENDING_THRESHOLD_MS = 10 * 60_000;

export interface ReconcileSummary {
  /** Stale CLAIMED outbox rows released back to PENDING with backoff. */
  released: number;
  /** Hung SENDING dispatch rows marked RETRY (dispatcher work set re-processes them). */
  retried: number;
}

/**
 * Self-healing scheduled job (design §4.9/§7.5). Repairs stuck pipeline states
 * deterministically — every release/reset clears lockedAt/lockedBy and sets
 * nextAttemptAt so the claim predicate never permanently excludes a row:
 *
 *  1. PENDING rows already due for claim (`nextAttemptAt <= now`) are the relay's
 *     job — audit-log only, never mutated.
 *  2. CLAIMED rows with no dispatch progress (`lockedAt < now - 10m`) — a crashed
 *     relay/dispatcher left them unclaimable — are released back to PENDING with
 *     attemptCount++ and the schedule's next backoff, plus a dispatch event. The
 *     release is cross-checked against the snapshot's dispatch rows: a claim is
 *     only released when NO dispatch is SENDING/RETRY and recently active
 *     (`updatedAt >= now - 10m`) — a slow-but-live send must not be released,
 *     or a re-claimed job would send it concurrently.
 *  3. SENDING dispatch rows hung (`updatedAt < now - 10m`) are marked RETRY so the
 *     dispatcher work set re-processes them (work-set rule prevents re-sending
 *     already-SENT providers).
 *
 * The bulk release uses an updateMany whose WHERE matches the stale window and
 * restricts to the cross-checked row ids, so a row that recovered between the
 * read and the write is never double-released.
 */
@Injectable()
export class ReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Run one reconcile sweep. `now` is injectable for deterministic tests. */
  async reconcile(now = new Date()): Promise<ReconcileSummary> {
    const claimedCutoff = new Date(now.getTime() - STALE_CLAIM_THRESHOLD_MS);
    const sendingCutoff = new Date(now.getTime() - HUNG_SENDING_THRESHOLD_MS);

    // 1. Stale PENDING — claim-eligible; the relay picks these up. Audit only.
    const duePending = await this.prisma.trackingOutbox.count({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    });
    if (duePending > 0) {
      this.logger.log(
        `Reconciler: ${duePending} PENDING outbox rows are due for claim (relay picks them up)`,
      );
    }

    // 2. Stale CLAIMED outbox rows — release with backoff + audit event. A claim
    // is only released when no dispatch for its snapshot is actively progressing
    // (SENDING/RETRY updated within the hang window); otherwise the send is simply
    // slow, and releasing would let a second relay double-send it.
    const stuck = await this.prisma.trackingOutbox.findMany({
      where: { status: 'CLAIMED', lockedAt: { lt: claimedCutoff } },
      select: { id: true, snapshotId: true, attemptCount: true },
    });
    let released = 0;
    if (stuck.length) {
      const snapshotIds = [...new Set(stuck.map((r) => r.snapshotId))];

      // Cross-check dispatch progress for every candidate snapshot in one read.
      const liveDispatches = await this.prisma.trackingDispatch.findMany({
        where: {
          snapshotId: { in: snapshotIds },
          status: { in: ['SENDING', 'RETRY'] },
          updatedAt: { gte: sendingCutoff },
        },
        select: { snapshotId: true },
      });
      const liveSnapshotIds = new Set(liveDispatches.map((d) => d.snapshotId));
      // Only rows whose non-terminal dispatch rows are all stale themselves may
      // be released; a snapshot with a live dispatch stays CLAIMED.
      const releaseable = stuck.filter((r) => !liveSnapshotIds.has(r.snapshotId));

      if (releaseable.length) {
        const snapshots = await this.prisma.trackingSnapshot.findMany({
          where: { id: { in: [...new Set(releaseable.map((r) => r.snapshotId))] } },
        });
        const snapshotById = new Map(snapshots.map((s) => [s.id, s]));

        // Bulk release: only cross-checked rows still inside the stale window are
        // touched (a row that recovered between read and write is never released).
        await this.prisma.trackingOutbox.updateMany({
          where: {
            id: { in: releaseable.map((r) => r.id) },
            status: 'CLAIMED',
            lockedAt: { lt: claimedCutoff },
          },
          data: {
            status: 'PENDING',
            attemptCount: { increment: 1 },
            lockedAt: null,
            lockedBy: null,
          },
        });

        for (const row of releaseable) {
          const nextAttempt = row.attemptCount + 1;
          // updateMany can't express per-row backoff — apply nextAttemptAt per row
          // from the pre-read attemptCount. The guard skips a row already
          // re-claimed between the bulk release and this write; a release that
          // did not stick earns no audit event.
          const backoff = await this.prisma.trackingOutbox.updateMany({
            where: { id: row.id, status: 'PENDING', lockedAt: null },
            data: {
              nextAttemptAt: new Date(now.getTime() + getRetryBackoffMs(nextAttempt)),
            },
          });
          if (backoff.count === 0) continue;
          released++;
          const snap = snapshotById.get(row.snapshotId);
          await this.prisma.trackingDispatchEvent.create({
            data: {
              snapshotId: row.snapshotId,
              eventId: snap?.eventId ?? row.snapshotId,
              orderId: snap?.orderId ?? null,
              ctxId: snap?.ctxId ?? null,
              provider: null,
              queueJobId: null,
              fromStatus: 'CLAIMED',
              toStatus: 'PENDING',
              attempt: nextAttempt,
              message: 'reconciler: stale claim released',
            },
          });
        }
      }
    }

    // 3. Hung SENDING dispatch rows — mark RETRY so the dispatcher re-processes them.
    const hung = await this.prisma.trackingDispatch.findMany({
      where: { status: 'SENDING', updatedAt: { lt: sendingCutoff } },
      select: {
        id: true,
        snapshotId: true,
        eventId: true,
        orderId: true,
        ctxId: true,
        provider: true,
        queueJobId: true,
        attemptCount: true,
      },
    });
    let retried = 0;
    if (hung.length) {
      await this.prisma.trackingDispatch.updateMany({
        where: { status: 'SENDING', updatedAt: { lt: sendingCutoff } },
        data: { status: 'RETRY' },
      });
      for (const row of hung) {
        await this.prisma.trackingDispatchEvent.create({
          data: {
            snapshotId: row.snapshotId,
            eventId: row.eventId,
            orderId: row.orderId ?? null,
            ctxId: row.ctxId ?? null,
            provider: row.provider,
            queueJobId: row.queueJobId ?? null,
            fromStatus: 'SENDING',
            toStatus: 'RETRY',
            attempt: row.attemptCount,
            message: 'reconciler: hung dispatch marked retry',
          },
        });
      }
      retried = hung.length;
    }

    return { released, retried };
  }

  /** Start the 60s reconcile loop. No-op when already running. */
  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.reconcile().catch((err) =>
        this.logger.error(`Reconcile iteration failed: ${err}`),
      );
    }, RECONCILE_INTERVAL_MS);
    this.logger.log(`Tracking reconciler started (every ${RECONCILE_INTERVAL_MS}ms)`);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }
}
