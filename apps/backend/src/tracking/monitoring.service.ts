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

/** Identity/context coverage over the window (2026-08-10 incident follow-up). */
export interface IdentityCoverageRow {
  /** Which canonical field this row measures. */
  field: string;
  /** Windowed base population the coverage is measured against. */
  base: 'snapshot' | 'context';
  /** Records in the window that carry the field. */
  count: number;
  /** Records in the window (denominator). */
  total: number;
  /** count / total — the share of captures carrying the field. */
  coverage: number;
}

/** Coverage thresholds — leave room for guest-heavy stores; avoid false alarms. */
const COVERAGE_MIN_VOLUME = 100;
const EMAIL_COVERAGE_MIN = 0.25;
const CONTEXT_COVERAGE_MIN = 0.75;
/** DLQ queue depth beyond which ops should clear/requeue dead events. */
const DLQ_DEPTH_MAX = 500;

/**
 * Schema-less EMQ quality proxy (Wave-2.4 MON-2). Counts `TrackingDispatchEvent`
 * rows whose `message` begins with the dispatcher's `match-key quality:` prefix
 * (produced by the Meta adapter when user_data lacks em/ph). `noEmPhShare` is the
 * flagged fraction of windowed provider dispatches — an internal at-risk rate
 * (NOT Meta's authoritative EMQ score, which lives in the Dataset Quality API).
 */
export interface EmqProxy {
  windowedDispatches: number;
  qualityFlagged: number;
  noEmPhShare: number;
}

/** Wave-2.4 MON-3: consolidated dispatch-quality rates over the window. */
export interface QualityRates {
  /** Provider dispatch-attempt rows created in the window (all dispatchers). */
  windowedDispatches: number;
  sent: number;
  deduped: number;
  failed: number;
  dead: number;
  retried: number;
  /**
   * Capture-level duplicate attempts in the window (TrackingDispatchEvent rows
   * with message 'capture dedup' — produced by TrackingCaptureService when the
   * snapshot's eventId UNIQUE skipped a re-capture). This is what dedupeRate
   * measures: dispatch rows never reach DEDUPED because capture-time
   * skipDuplicates is the actual dedup.
   */
  dedupedCaptures: number;
  /** Snapshots created in the window (denominator for capture-level dedup). */
  capturedSnapshots: number;
  /** Dispatch events in the window whose message is the replay marker. */
  replayed: number;
  /**
   * Capture-level dedup share — dedupedCaptures / (capturedSnapshots +
   * dedupedCaptures). 0 = every attempted capture was unique.
   */
  dedupRate: number;
  /** retry attempts / provider dispatch attempts — per-attempt retry intensity. */
  retryRate: number;
  emq: EmqProxy;
  mirror: MirrorCaptureStats;
}

/** Wave-2.4 MON-4: a single actionable ops alert produced by getWatchdog. */
export interface WatchdogViolation {
  severity: 'critical' | 'warning' | 'info';
  code: string;
  message: string;
}

/** Wave-2.4 MON-4: 0-100 composite health score, grade, and the penalties behind it. */
export interface HealthScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  penalties: { code: string; points: number; message: string }[];
}

/** Ops alert thresholds (Wave-2.4 MON-4), aligned with the freshness SLO + DLQ cadence. */
const RELAY_STALE_SEC = 60;
const DEAD_FAILURE_SPIKE = 10;
const RETRY_RATE_MAX = 0.2;
const EMQ_GAP_MAX = 0.5;
const DISPATCHER_IN_FLIGHT_MAX = 5;

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

  /**
   * EMQ quality proxy (Wave-2.4 MON-2): share of windowed provider dispatches
   * flagged by the adapter's `match-key quality:` event (NO_EM_PH / NO_IDENTITY).
   * Schema-less (counts TrackingDispatchEvent), an internal at-risk rate — the
   * authoritative EMQ score is Meta's Dataset Quality API (out-of-band reader).
   */
  async getEmqProxy(hours: number): Promise<EmqProxy> {
    const cutoff = this.cutoff(hours);
    const [qualityFlagged, windowedDispatches] = await Promise.all([
      this.prisma.trackingDispatchEvent.count({
        where: {
          createdAt: { gte: cutoff },
          message: { startsWith: 'match-key quality:' },
        },
      }),
      this.prisma.trackingDispatchEvent.count({
        where: { createdAt: { gte: cutoff }, provider: { not: null } },
      }),
    ]);
    return {
      windowedDispatches,
      qualityFlagged,
      noEmPhShare: windowedDispatches > 0 ? qualityFlagged / windowedDispatches : 0,
    };
  }

  /**
   * Wave-2.4 MON-3: one consolidated dispatch-quality view — the terminal-state
   * funnel (sent/deduped/failed/dead/retried), replay volume, dedup + retry
   * rates, and the EMQ/mirror proxies. Rates are fractions in [0,1]: dedupRate
   * is the event-id dedup share (0 = nothing deduped), retryRate is the share of
   * dispatch attempts that transitioned RETRY (0 = clean). Never throws; a
   * window with no dispatches returns zero-filled rates with the proxies.
   */
  async getQualityRates(hours: number): Promise<QualityRates> {
    const cutoff = this.cutoff(hours);
    const [rows, retriedAttempts, windowedDispatches, replayed, emq, mirror] =
      await Promise.all([
        this.prisma.trackingDispatch.groupBy({
          by: ['status'],
          _count: true,
          where: { createdAt: { gte: cutoff } },
        }),
        this.prisma.trackingDispatchEvent.count({
          where: { createdAt: { gte: cutoff }, toStatus: 'RETRY' },
        }),
        this.prisma.trackingDispatchEvent.count({
          where: { createdAt: { gte: cutoff }, provider: { not: null } },
        }),
        this.prisma.trackingDispatchEvent.count({
          where: { createdAt: { gte: cutoff }, message: 'replay' },
        }),
        this.getEmqProxy(hours),
        this.getMirrorCapture(hours),
      ]);
    // Capture-level dedup + snapshot volume (Wave-2.4 MON-3 fix): duplicate
    // attempts are skipped at capture (eventId UNIQUE), never at dispatch — the
    // previous dedupRate read dispatch DEDUPED rows, which by construction stay
    // at zero (dedup rate always 0.0% regardless of real duplicate volume).
    const [dedupedCaptures, capturedSnapshots] = await Promise.all([
      this.prisma.trackingDispatchEvent.count({
        where: { createdAt: { gte: cutoff }, message: 'capture dedup' },
      }),
      this.prisma.trackingSnapshot.count({ where: { createdAt: { gte: cutoff } } }),
    ]);
    const counts: Partial<Record<DispatchStatus, number>> = {};
    for (const row of rows) counts[row.status as DispatchStatus] = row._count;
    const sent = counts.SENT ?? 0;
    const deduped = counts.DEDUPED ?? 0;
    const failed = counts.FAILED ?? 0;
    const dead = counts.DEAD ?? 0;
    const retried = counts.RETRY ?? 0;
    const dedupTotal = capturedSnapshots + dedupedCaptures;
    return {
      windowedDispatches,
      sent,
      deduped,
      failed,
      dead,
      retried,
      dedupedCaptures,
      capturedSnapshots,
      replayed,
      dedupRate: dedupTotal > 0 ? dedupedCaptures / dedupTotal : 0,
      retryRate: windowedDispatches > 0 ? retriedAttempts / windowedDispatches : 0,
      emq,
      mirror,
    };
  }

  /**
   * Identity/context field coverage over the window (2026-08-10 incident
   * follow-up). Counts, per canonical field, the share of windowed captures
   * carrying it: contact/geo fields are snapshot `payload.customer.*` JSON
   * paths; ip/userAgent are TrackingContext columns; externalId coverage is
   * 100% by construction (server-generated per journey). This mirrors the
   * Meta-side coverage survey (IP/UA/fbp/fbc 55.56%, City 33.33%…) with
   * server-side truth — the providers' dataset-quality view stays out-of-band.
   */
  async getIdentityCoverage(hours: number): Promise<IdentityCoverageRow[]> {
    const cutoff = this.cutoff(hours);
    const snapshotBase = {
      createdAt: { gte: cutoff },
    } as const;
    const [em, ph, fn, ln, ct, st, zp, cn, ip, ua, base] = await Promise.all([
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'email'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'phone'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'firstName'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'lastName'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'city'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'state'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'zip'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingSnapshot.count({
        where: {
          ...snapshotBase,
          payload: { path: ['customer', 'country'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingContext.count({
        where: { createdAt: { gte: cutoff }, ip: { not: '' } },
      }),
      this.prisma.trackingContext.count({
        where: { createdAt: { gte: cutoff }, userAgent: { not: '' } },
      }),
      this.prisma.trackingSnapshot.count({ where: snapshotBase }),
    ]);
    const rows: IdentityCoverageRow[] = [];
    const push = (
      field: string,
      baseOf: 'snapshot' | 'context',
      count: number,
      total: number,
    ) => {
      rows.push({
        field,
        base: baseOf,
        count,
        total,
        coverage: total > 0 ? count / total : 0,
      });
    };
    push('email', 'snapshot', em, base);
    push('phone', 'snapshot', ph, base);
    push('firstName', 'snapshot', fn, base);
    push('lastName', 'snapshot', ln, base);
    push('city', 'snapshot', ct, base);
    push('state', 'snapshot', st, base);
    push('zip', 'snapshot', zp, base);
    push('country', 'snapshot', cn, base);
    const ctxBase = await this.prisma.trackingContext.count({
      where: { createdAt: { gte: cutoff } },
    });
    push('ip', 'context', ip, ctxBase);
    push('userAgent', 'context', ua, ctxBase);
    return rows;
  }

  /**
   * Wave-2.4 MON-4: actionable ops alerts. Each violation is the SDL (signal →
   * detection → loop) of one pipeline failure mode: relay stall, Redis/queue
   * down, dispatcher back-pressure, FAILED/DEAD spike, elevated retry rate, or a
   * persistent EMQ match gap. `info` = configuration state (not an error),
   * `warning` = elevated but self-healing, `critical` = pipeline at risk.
   */
  async getWatchdog(hours: number): Promise<WatchdogViolation[]> {
    const [health, quality, dead, coverage] = await Promise.all([
      this.getRuntimeHealth(),
      this.getQualityRates(hours),
      this.getDeadStats(),
      this.getIdentityCoverage(hours),
    ]);
    const { relay, redis, queue, dispatcher } = health;
    const violations: WatchdogViolation[] = [];

    if (!relay.relayEnabled) {
      violations.push({
        severity: 'info',
        code: 'relay-disabled',
        message:
          'Outbox relay is disabled — PENDING outbox rows are not being dispatched; enable it to go live.',
      });
    } else if (
      relay.oldestPendingAgeSec !== null &&
      relay.oldestPendingAgeSec > RELAY_STALE_SEC
    ) {
      violations.push({
        severity: 'critical',
        code: 'relay-backlog',
        message: `Oldest pending outbox is ${relay.oldestPendingAgeSec}s past due — the relay is stalled; check worker liveness.`,
      });
    }

    if (!redis.connected) {
      violations.push({
        severity: 'critical',
        code: 'redis-down',
        message:
          'Redis (BullMQ) connection is unavailable — dispatch workers cannot process jobs.',
      });
    }
    if (!queue.reachable) {
      violations.push({
        severity: 'critical',
        code: 'queue-down',
        message:
          'The tracking queue is unreachable — job counts cannot be read; workers are likely down.',
      });
    } else if (queue.failed > 0) {
      violations.push({
        severity: 'warning',
        code: 'queue-failed-jobs',
        message: `${queue.failed} failed queue jobs waiting for retry — review the queue for poisoned jobs.`,
      });
    }

    if (dispatcher.sending >= DISPATCHER_IN_FLIGHT_MAX) {
      violations.push({
        severity: 'info',
        code: 'dispatcher-backed-up',
        message: `${dispatcher.sending} dispatches are currently in flight — possible back-pressure from a provider API.`,
      });
    }

    const terminalFailures = quality.failed + quality.dead;
    if (terminalFailures > DEAD_FAILURE_SPIKE) {
      violations.push({
        severity: 'warning',
        code: 'dead-failure-spike',
        message: `${terminalFailures} dispatches ended FAILED/DEAD in the window — check the failures tab and DLQ for recovery.`,
      });
    }
    if (quality.retryRate > RETRY_RATE_MAX) {
      violations.push({
        severity: 'warning',
        code: 'retry-rate-high',
        message: `Retry rate ${(quality.retryRate * 100).toFixed(0)}% exceeds ${RETRY_RATE_MAX * 100}% — provider rejections or transient errors are elevated.`,
      });
    }
    if (quality.emq.windowedDispatches > 0 && quality.emq.noEmPhShare >= EMQ_GAP_MAX) {
      violations.push({
        severity: 'warning',
        code: 'emq-match-gap',
        message: `${(quality.emq.noEmPhShare * 100).toFixed(0)}% of dispatches lack EMQ contact keys (em/ph) — Meta match/attribution quality is at risk; enable tracking_advanced_matching.`,
      });
    }

    // 2026-08-10 incident follow-up watchdog signals. The 8559-event DLQ pile-up
    // was silent for weeks because no signal watched the DLQ queue depth or
    // capture identity coverage — both added here.
    if (dead.dlqDepth > DLQ_DEPTH_MAX) {
      violations.push({
        severity: 'warning',
        code: 'dlq-depth-high',
        message: `DLQ queue holds ${dead.dlqDepth} dead events (${dead.deadCount} DEAD outbox rows) — investigate the top failure signature; recent dead events can be replayed from the DEAD list.`,
      });
    }
    if (
      quality.mirror.totalSnapshots > 20 &&
      quality.mirror.browserMirrorRatio < 0.5
    ) {
      violations.push({
        severity: 'warning',
        code: 'mirror-collapse',
        message: `Only ${(quality.mirror.browserMirrorRatio * 100).toFixed(0)}% of captured events arrived via the browser mirror (${quality.mirror.totalSnapshots} total) — server-side captures dominate or the mirror is failing; check the storefront mirror POST.`,
      });
    }
    const emRow = coverage.find((r) => r.field === 'email');
    if (
      emRow &&
      emRow.total >= COVERAGE_MIN_VOLUME &&
      emRow.coverage < EMAIL_COVERAGE_MIN
    ) {
      violations.push({
        severity: 'warning',
        code: 'identity-coverage-low',
        message: `Email coverage is ${(emRow.coverage * 100).toFixed(0)}% of ${emRow.total} captures — Meta matching depends on em/ph; review advanced-matching enablement and identity collection.`,
      });
    }
    const ctxRows = coverage.filter((r) => r.base === 'context');
    const ctxTotal = ctxRows[0]?.total ?? 0;
    const ipRow = ctxRows.find((r) => r.field === 'ip');
    if (
      ipRow &&
      ctxTotal >= COVERAGE_MIN_VOLUME &&
      ipRow.coverage < CONTEXT_COVERAGE_MIN
    ) {
      violations.push({
        severity: 'warning',
        code: 'context-coverage-low',
        message: `IP coverage is ${(ipRow.coverage * 100).toFixed(0)}% of ${ctxTotal} contexts — context rows missing ip/ua degrade Meta user_data (2804050 risk); verify the context beacon and mirror fold-in.`,
      });
    }

    return violations;
  }

  /**
   * Wave-2.4 MON-4: 0-100 pipeline health score derived from the watchdog. Each
   * signal maps to a penalty (critical plumbing = 20, degradation = ≤10, config
   * = 5); the score is clamped to [0,100] with an A–F grade. Ops should treat
   * the score as a single-page drift signal and the penalties as the drill-down.
   */
  async getHealthScore(hours: number): Promise<HealthScore> {
    let score = 100;
    const penalties: HealthScore['penalties'] = [];
    const [violations, quality] = await Promise.all([
      this.getWatchdog(hours),
      this.getQualityRates(hours),
    ]);
    const penalize = (code: string, points: number, message: string) => {
      score -= points;
      penalties.push({ code, points, message });
    };
    for (const v of violations) {
      switch (v.code) {
        case 'relay-disabled':
          penalize(v.code, 5, v.message);
          break;
        case 'relay-backlog':
          penalize(v.code, 20, v.message);
          break;
        case 'redis-down':
          penalize(v.code, 20, v.message);
          break;
        case 'queue-down':
          penalize(v.code, 20, v.message);
          break;
        case 'queue-failed-jobs':
          penalize(v.code, 5, v.message);
          break;
        case 'dispatcher-backed-up':
          penalize(v.code, 5, v.message);
          break;
        case 'dead-failure-spike':
          penalize(v.code, Math.min(20, quality.failed + quality.dead), v.message);
          break;
        case 'retry-rate-high':
          penalize(v.code, 10, v.message);
          break;
        case 'emq-match-gap':
          penalize(v.code, 10, v.message);
          break;
        case 'dlq-depth-high':
          penalize(v.code, 10, v.message);
          break;
        case 'mirror-collapse':
          penalize(v.code, 10, v.message);
          break;
        case 'identity-coverage-low':
          penalize(v.code, 10, v.message);
          break;
        case 'context-coverage-low':
          penalize(v.code, 10, v.message);
          break;
        default:
          break;
      }
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade: HealthScore['grade'] =
      score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
    return { score, grade, penalties };
  }

  private cutoff(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }
}
