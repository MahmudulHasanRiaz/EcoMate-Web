import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DlqService, DlqStats } from './dlq.service';
import { DispatchStatus, DISPATCH_STATUS } from './tracking.constants';
import { TrackingSettingsService } from './tracking-settings.service';
import {
  RELAY_ENABLED_ENV_KEY,
  RELAY_ENABLED_SETTING_KEY,
} from './outbox-relay.service';

export interface VolumeByEventTypeRow {
  eventType: string;
  count: number;
}

/** Per-provider dispatch funnel — every DISPATCH_STATUS key, defaulted to 0. */
export interface DispatchFunnel {
  pending: number;
  sending: number;
  sent: number;
  retry: number;
  failed: number;
  dead: number;
  skipped: number;
  deduped: number;
}

export interface RetryHistogramRow {
  attemptCount: number;
  count: number;
}

export interface TopFailureRow {
  errorMsg: string;
  count: number;
}

export interface FreshnessStats {
  avgCaptureToDispatchSec: number;
  p95CaptureToDispatchSec: number;
}

export interface DedupKeyUsageRow {
  key: 'event_id' | 'context_external_id' | 'fbp' | 'fbc';
  events: number;
}

/** Relay go-live health (Decision G / R1). ops alert on pending age. */
export interface RelayHealth {
  relayEnabled: boolean;
  pendingCount: number;
  claimedCount: number;
  /** Seconds past due of the oldest PENDING outbox (0 / null when none is due). */
  oldestPendingAgeSec: number | null;
}

/** Redis connectivity (BullMQ Queue liveness). */
export interface RedisHealth {
  connected: boolean;
}

/** BullMQ `tracking` queue + worker liveness (job counts). */
export interface QueueHealth {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  /** true when job counts could be read (a live queue/worker). */
  reachable: boolean;
}

/** Dispatcher liveness proxy: dispatch rows currently in SENDING. */
export interface DispatcherHealth {
  sending: number;
}

/** Expanded runtime health for the ops endpoint (Wave-1 correction #5). */
export interface RuntimeHealth {
  relay: RelayHealth;
  redis: RedisHealth;
  queue: QueueHealth;
  dispatcher: DispatcherHealth;
}

/** Browser-mirror capture reliability (Wave-1) — NOT Meta coverage. */
export interface MirrorCaptureStats {
  totalSnapshots: number;
  browserOrigin: number;
  serverOrigin: number;
  browserMirrorRatio: number;
}

/** Upper-case stored status -> lower-case funnel key. */
const STATUS_TO_FUNNEL_KEY: Record<DispatchStatus, keyof DispatchFunnel> = {
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  RETRY: 'retry',
  FAILED: 'failed',
  DEAD: 'dead',
  SKIPPED: 'skipped',
  DEDUPED: 'deduped',
};

const EMPTY_FUNNEL: DispatchFunnel = Object.freeze({
  pending: 0,
  sending: 0,
  sent: 0,
  retry: 0,
  failed: 0,
  dead: 0,
  skipped: 0,
  deduped: 0,
});

/** Cap on a single error message surfaced to the dashboard (keeps the payload bounded). */
const MAX_ERROR_MSG_LENGTH = 300;

/**
 * MonitoringService (Phase 6) — read-only aggregate queries for the ops
 * dashboard. Every method is a Prisma aggregate/groupBy over the tracking
 * tables; no raw SQL and no writes. The funnel, retry histogram, and top
 * failures are windowed on `trackingDispatch.createdAt`; freshness is windowed
 * on `trackingOutbox.createdAt`; volume/dedup-key usage on `trackingSnapshot`
 * (and `trackingContext` for the fbp/fbc approximation).
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dlq: DlqService,
    private readonly settings: TrackingSettingsService,
    @InjectQueue('tracking') private readonly trackingQueue: Queue,
  ) {}

  /** Snapshot event volume by eventType over the last `hours` hours. */
  async getVolumeByEventType(hours: number): Promise<VolumeByEventTypeRow[]> {
    const rows = await this.prisma.trackingSnapshot.groupBy({
      by: ['eventType'],
      _count: true,
      where: { createdAt: { gte: this.cutoff(hours) } },
    });
    return rows.map((row) => ({ eventType: row.eventType, count: row._count }));
  }

  /** Per-provider dispatch funnel over the window; every status defaulted to 0. */
  async getDispatchFunnel(provider: string, hours: number): Promise<DispatchFunnel> {
    const rows = await this.prisma.trackingDispatch.groupBy({
      by: ['status'],
      _count: true,
      where: { provider, createdAt: { gte: this.cutoff(hours) } },
    });
    const funnel: DispatchFunnel = { ...EMPTY_FUNNEL };
    for (const row of rows) {
      const key = STATUS_TO_FUNNEL_KEY[row.status as DispatchStatus];
      if (key) funnel[key] = row._count;
    }
    return funnel;
  }

  /** Reuse the Phase 5 DEAD-outbox + DLQ-queue-depth stats verbatim. */
  getDeadStats(): Promise<DlqStats> {
    return this.dlq.getStats();
  }

  /** Retry attempt distribution across all dispatches (attemptCount > 0), ascending. */
  async getRetryHistogram(): Promise<RetryHistogramRow[]> {
    const rows = await this.prisma.trackingDispatch.groupBy({
      by: ['attemptCount'],
      _count: true,
      where: { attemptCount: { gt: 0 } },
    });
    return rows
      .map((row) => ({ attemptCount: row.attemptCount, count: row._count }))
      .sort((a, b) => a.attemptCount - b.attemptCount);
  }

  /** Most common terminal failure messages, truncated to a safe display length. */
  async getTopFailures(limit = 10): Promise<TopFailureRow[]> {
    const rows = await this.prisma.trackingDispatch.groupBy({
      by: ['errorMsg'],
      _count: true,
      where: {
        errorMsg: { not: null },
        status: { in: ['FAILED', 'DEAD'] },
      },
      orderBy: { _count: { errorMsg: 'desc' } },
      take: limit,
    });
    return rows.map((row) => ({
      errorMsg: (row.errorMsg ?? '').slice(0, MAX_ERROR_MSG_LENGTH),
      count: row._count,
    }));
  }

  /**
   * Capture -> dispatch latency over dispatched outboxes in the window. avg is
   * the mean; p95 is the nearest-rank percentile of the sorted per-row deltas
   * (ceil(0.95 * n)-th value, 1-based). Zero-filled when no row qualifies.
   */
  async getFreshness(hours: number): Promise<FreshnessStats> {
    const rows = await this.prisma.trackingOutbox.findMany({
      where: {
        dispatchedAt: { not: null },
        createdAt: { gte: this.cutoff(hours) },
      },
      select: { createdAt: true, dispatchedAt: true },
    });
    const seconds = rows
      .filter((row) => row.dispatchedAt !== null)
      .map((row) => (row.dispatchedAt!.getTime() - row.createdAt.getTime()) / 1000)
      .sort((a, b) => a - b);
    if (seconds.length === 0) {
      return { avgCaptureToDispatchSec: 0, p95CaptureToDispatchSec: 0 };
    }
    const avg = seconds.reduce((sum, s) => sum + s, 0) / seconds.length;
    const p95Index = Math.max(
      0,
      Math.min(seconds.length - 1, Math.ceil(0.95 * seconds.length) - 1),
    );
    return {
      avgCaptureToDispatchSec: avg,
      p95CaptureToDispatchSec: seconds[p95Index],
    };
  }

  /**
   * Dedup-relevant key usage over the window.
   *
   * Approximation note: `event_id` counts snapshots (every snapshot carries an
   * event_id). `context_external_id`, `fbp`, and `fbc` are journey-level values
   * kept on TrackingContext (`external_id` is generated on every context row;
   * `fbp`/`fbc` are read from `identifiers.meta.*`), so those three rows count
   * distinct context rows — an upper bound on events, not an exact event count,
   * since a context covers many snapshots.
   */
  async getDedupKeyUsage(hours: number): Promise<DedupKeyUsageRow[]> {
    const cutoff = this.cutoff(hours);
    const [eventIdCount, externalIdCount, fbpCount, fbcCount] = await Promise.all([
      this.prisma.trackingSnapshot.count({ where: { createdAt: { gte: cutoff } } }),
      // external_id is server-generated on EVERY TrackingContext row (never in a
      // snapshot payload), so the correct usage proxy is the context row count in
      // the window — an upper bound on events, same approximation as fbp/fbc.
      this.prisma.trackingContext.count({
        where: { createdAt: { gte: cutoff } },
      }),
      this.prisma.trackingContext.count({
        where: {
          createdAt: { gte: cutoff },
          identifiers: { path: ['meta', 'fbp', 'value'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingContext.count({
        where: {
          createdAt: { gte: cutoff },
          identifiers: { path: ['meta', 'fbc', 'value'], not: Prisma.DbNull },
        },
      }),
    ]);
    return [
      { key: 'event_id', events: eventIdCount },
      // context_external_id reflects TrackingContext AVAILABILITY, not Meta
      // external_id dedup (external_id is assigned to every context row). Label
      // reflects the actual semantics (Wave-1 correction #4).
      { key: 'context_external_id', events: externalIdCount },
      { key: 'fbp', events: fbpCount },
      { key: 'fbc', events: fbcCount },
    ];
  }

  /**
   * Relay go-live health (Wave 1): is the relay enabled, and how far behind is
   * the outbox? `oldestPendingAgeSec` is the age past-due of the most-overdue
   * PENDING row (the claim predicate is nextAttemptAt <= now); ops should alert
   * when it exceeds the freshness SLO while the relay is enabled.
   */
  async getRelayHealth(): Promise<RelayHealth> {
    const relayRaw = await this.settings.get(
      RELAY_ENABLED_SETTING_KEY,
      RELAY_ENABLED_ENV_KEY,
    );
    const [pendingCount, oldestPending, claimedCount] = await Promise.all([
      this.prisma.trackingOutbox.count({ where: { status: 'PENDING' } }),
      this.prisma.trackingOutbox.findFirst({
        where: { status: 'PENDING' },
        orderBy: { nextAttemptAt: 'asc' },
        select: { nextAttemptAt: true },
      }),
      this.prisma.trackingOutbox.count({ where: { status: 'CLAIMED' } }),
    ]);
    const oldestPendingAgeSec =
      oldestPending?.nextAttemptAt &&
      oldestPending.nextAttemptAt.getTime() < Date.now()
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - oldestPending.nextAttemptAt.getTime()) / 1000,
            ),
          )
        : null;
    return {
      relayEnabled: relayRaw === 'true',
      pendingCount,
      claimedCount,
      oldestPendingAgeSec,
    };
  }

  /**
   * Browser-mirror capture reliability ratio (Wave-1 correction #3). Browser
   * mirror captures carry configSnapshot.source === 'browser'; server-authoritative
   * captures do not. The browser-mirror ratio is the share of captured events that
   * arrived via the browser mirror — a proxy for mirror reliability, NOT Meta
   * coverage (Meta's ≥75% target is measured in Events Manager, the authoritative view).
   */
  async getMirrorCapture(hours: number): Promise<MirrorCaptureStats> {
    const cutoff = this.cutoff(hours);
    const [browserOrigin, total] = await Promise.all([
      this.prisma.trackingOutbox.count({
        where: {
          createdAt: { gte: cutoff },
          configSnapshot: { path: ['source'], equals: 'browser' },
        },
      }),
      this.prisma.trackingOutbox.count({ where: { createdAt: { gte: cutoff } } }),
    ]);
    return {
      totalSnapshots: total,
      browserOrigin,
      serverOrigin: total - browserOrigin,
      browserMirrorRatio: total > 0 ? browserOrigin / total : 0,
    };
  }

  /**
   * Expanded runtime health (Wave-1 correction #5) covering the four layers:
   * relay (outbox backlog), Redis (queue connectivity), BullMQ worker (job
   * counts), and dispatcher (sending rows). Every subsystem read is guarded so a
   * single layer failure degrades just that field.
   */
  async getRuntimeHealth(): Promise<RuntimeHealth> {
    const [relay, queue, dispatcher] = await Promise.all([
      this.getRelayHealth(),
      this.getQueueHealth(),
      this.prisma.trackingDispatch.count({ where: { status: 'SENDING' } }),
    ]);
    return {
      relay,
      redis: { connected: await this.redisConnected() },
      queue,
      dispatcher: { sending: dispatcher },
    };
  }

  private async getQueueHealth(): Promise<QueueHealth> {
    try {
      const c = await this.trackingQueue.getJobCounts();
      return {
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        delayed: c.delayed ?? 0,
        failed: c.failed ?? 0,
        completed: c.completed ?? 0,
        reachable: true,
      };
    } catch {
      return { waiting: -1, active: -1, delayed: -1, failed: -1, completed: -1, reachable: false };
    }
  }

  private async redisConnected(): Promise<boolean> {
    try {
      // BullMQ exposes the resolved Redis version as a synchronous getter; it
      // throws when the queue's Redis connection is unavailable.
      return typeof this.trackingQueue.redisVersion === 'string';
    } catch {
      return false;
    }
  }

  private cutoff(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }
}
