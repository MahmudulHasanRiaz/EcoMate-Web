import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingSettingsService } from './tracking-settings.service';

/** A row claimed by the raw SQL UPDATE ... RETURNING. */
export interface ClaimedOutboxRow {
  id: string;
  snapshotId: string;
  attemptCount: number;
}

/** Settings key (system_setting) / env fallback for the relay on/off switch. */
export const RELAY_ENABLED_SETTING_KEY = 'tracking_relay_enabled';
export const RELAY_ENABLED_ENV_KEY = 'TRACKING_RELAY_ENABLED';

/** Interval between poll ticks when started. */
const POLL_INTERVAL_MS = 1000;

/**
 * Outbox relay: claims due PENDING outbox rows (raw SQL, SKIP LOCKED, one
 * consumer-safe claim per poll) and enqueues one BullMQ `tracking` job per row.
 *
 * On an enqueue failure the row's lock is released (back to PENDING with
 * lockedAt/lockedBy cleared) so the next poll (or another relay instance) can
 * pick it up — the row is counted as not-enqueued.
 *
 * start()/stop() drive the poll loop; the loop only runs when the
 * `tracking_relay_enabled` setting/env is exactly 'true'.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('tracking') private readonly trackingQueue: Queue,
    private readonly settings: TrackingSettingsService,
  ) {}

  /**
   * Claim up to `batchSize` due outbox rows and enqueue one tracking job each.
   * Returns the number of rows successfully enqueued (rows whose enqueue threw
   * are un-claimed and not counted).
   *
   * The claim uses a single parameterized UPDATE ... WHERE id IN (SELECT ...
   * LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING — concurrent relay instances
   * never double-claim a row, and no raw strings are interpolated into SQL.
   */
  async poll(batchSize = 50, instanceId = 'relay-1'): Promise<number> {
    if (!(await this.isRelayEnabled())) return 0;

    let claimed: ClaimedOutboxRow[];
    try {
      claimed = await this.prisma.$queryRaw<ClaimedOutboxRow[]>(Prisma.sql`
        UPDATE "TrackingOutbox" SET status='CLAIMED', "lockedAt"=now(), "lockedBy"=${instanceId}
        WHERE id IN (
          SELECT id FROM "TrackingOutbox"
          WHERE status='PENDING' AND "nextAttemptAt"<=now() AND "lockedAt" IS NULL
          ORDER BY priority DESC, "nextAttemptAt" ASC
          LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "snapshotId", "attemptCount"
      `);
    } catch (err) {
      this.logger.error(`Outbox claim failed: ${err}`);
      return 0;
    }

    let enqueued = 0;
    for (const row of claimed ?? []) {
      try {
        await this.trackingQueue.add(
          'send',
          { snapshotId: row.snapshotId, outboxId: row.id, attemptCount: row.attemptCount },
          {
            jobId: `${row.id}:${row.attemptCount}`,
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
        enqueued++;
      } catch (err) {
        this.logger.error(
          `Failed to enqueue outbox ${row.id}; releasing lock: ${err}`,
        );
        await this.releaseLock(row.id);
      }
    }
    return enqueued;
  }

  /**
   * Start the poll loop. No-op when the relay is disabled or already running.
   * Wired to module bootstrap via onModuleInit(), and testable directly.
   */
  async start(): Promise<void> {
    if (!(await this.isRelayEnabled())) {
      this.logger.warn(`${RELAY_ENABLED_SETTING_KEY} is not 'true'; relay not started`);
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll().catch((err) =>
        this.logger.error(`Relay poll iteration failed: ${err}`),
      );
    }, POLL_INTERVAL_MS);
    this.logger.log(`Outbox relay started (poll every ${POLL_INTERVAL_MS}ms)`);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Module bootstrap: start the poll loop when the relay is enabled. `start()`
   * gates on the `tracking_relay_enabled` setting/env itself, so this is a safe
   * no-op when the pipeline is switched off — a single TrackingModule instance
   * means exactly one relay timer per app.
   */
  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  private async isRelayEnabled(): Promise<boolean> {
    return (
      (await this.settings.get(
        RELAY_ENABLED_SETTING_KEY,
        RELAY_ENABLED_ENV_KEY,
      )) === 'true'
    );
  }

  private async releaseLock(id: string): Promise<void> {
    try {
      await this.prisma.trackingOutbox.update({
        where: { id },
        data: { status: 'PENDING', lockedAt: null, lockedBy: null },
      });
    } catch (err) {
      this.logger.error(`Failed to release lock for outbox ${id}: ${err}`);
    }
  }
}
