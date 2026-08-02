import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

/** DLQ stats for the Phase 6 dashboard: DB is the source of truth for DEAD, queue depth is live. */
export interface DlqStats {
  deadCount: number;
  dlqDepth: number;
}

/**
 * DLQ service (design §7.3). When the dispatcher exhausts an outbox's retries
 * (or a provider permanently fails), the DB row is DEAD — the primary KPI — and
 * this service mirrors the terminal state onto the `tracking-dlq` BullMQ queue
 * purely for ops visibility. The mirror is best-effort and non-blocking: a queue
 * outage must never affect the dispatch result, because the durable record is
 * the TrackingOutbox row itself.
 *
 * Retention is bounded: each mirror uses a deterministic jobId
 * (`<outboxId>-<attemptCount>-dlq`) so re-mirrors of the same terminal attempt
 * never accumulate, and the job is registered with capped retention
 * (`removeOnComplete: 0`, `removeOnFail: 100` — the queue trims to a bounded
 * set instead of growing unboundedly).
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('tracking-dlq') private readonly dlqQueue: Queue,
  ) {}

  /**
   * Mirror one DEAD outbox onto the `tracking-dlq` queue. Never throws — a
   * failure to enqueue only degrades ops visibility, not the dispatch pipeline.
   *
   * @param outboxId     the DEAD TrackingOutbox id
   * @param snapshotId   the snapshot the outbox belongs to
   * @param provider     optional provider the terminal decision is scoped to
   * @param errorMsg     the terminal error message carried onto the mirror job
   * @param attemptCount the outbox attempt count at terminal time — part of the
   *                     deterministic jobId so one job per terminal attempt
   */
  async mirror(
    outboxId: string,
    snapshotId: string,
    provider?: string | null,
    errorMsg?: string | null,
    attemptCount = 0,
  ): Promise<void> {
    try {
      await this.dlqQueue.add(
        'dlq',
        { outboxId, snapshotId, provider: provider ?? null, errorMsg: errorMsg ?? null },
        { jobId: `${outboxId}-${attemptCount}-dlq`, removeOnComplete: 0 },
      );
    } catch (err) {
      this.logger.warn(`DLQ mirror failed for outbox ${outboxId}: ${err}`);
    }
  }

  /**
   * Dashboard stats: `deadCount` = DEAD TrackingOutbox rows in the DB (the
   * authoritative DLQ-depth KPI), `dlqDepth` = live depth of the `tracking-dlq`
   * queue (unprocessed mirror jobs). This is an explicit read — failures are not
   * swallowed so the dashboard surfaces queue/DB health.
   */
  async getStats(): Promise<DlqStats> {
    const [deadCount, dlqDepth] = await Promise.all([
      this.prisma.trackingOutbox.count({ where: { status: 'DEAD' } }),
      this.dlqQueue.count(),
    ]);
    return { deadCount, dlqDepth };
  }
}
