import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DlqService, DlqStats } from './dlq.service';
import { DispatchStatus, DISPATCH_STATUS } from './tracking.constants';

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
  key: 'event_id' | 'external_id' | 'fbp' | 'fbc';
  events: number;
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
   * Approximation note: `event_id` and `external_id` count snapshots (every
   * snapshot carries an event_id; external_id is counted when the raw payload
   * stores one). `fbp`/`fbc` are journey-level Meta identifiers kept on
   * TrackingContext (dispatchers read `identifiers.meta.fbp.value`), so those
   * two rows count distinct context rows — an upper bound on events, not an
   * exact event count, since a context covers many snapshots.
   */
  async getDedupKeyUsage(hours: number): Promise<DedupKeyUsageRow[]> {
    const cutoff = this.cutoff(hours);
    const [eventIdCount, externalIdCount, fbpCount, fbcCount] = await Promise.all([
      this.prisma.trackingSnapshot.count({ where: { createdAt: { gte: cutoff } } }),
      this.prisma.trackingSnapshot.count({
        where: {
          createdAt: { gte: cutoff },
          payload: { path: ['externalId'], not: Prisma.DbNull },
        },
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
      { key: 'external_id', events: externalIdCount },
      { key: 'fbp', events: fbpCount },
      { key: 'fbc', events: fbcCount },
    ];
  }

  private cutoff(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }
}
