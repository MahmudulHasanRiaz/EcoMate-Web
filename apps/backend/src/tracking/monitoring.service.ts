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
import { MonitoringDateRange } from './dto/monitoring.dto';

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
 * flagged fraction of windowed destination DELIVERIES — an internal at-risk rate
 * (NOT Meta's authoritative EMQ score, which lives in the Dataset Quality API).
 */
export interface EmqProxy {
  /** Destination delivery rows in the window (one per provider+destination). */
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
  /** Share of windowed destination deliveries that needed >=1 retry (fan-out invariant). */
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
 * Purchase reconciliation waterfall (configuration-aware):
 * Business Confirmed → Source Classification → Eligible/Excluded → Expected → Canonical → Matched/Missing/Unexpected
 */
export interface PurchaseReconciliation {
  // === BUSINESS LIFECYCLE ===
  newOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;

  // === SOURCE CLASSIFICATION (Confirmed orders by source) ===
  confirmedBySource: {
    DIRECT_WEBSITE: number;
    POS: number;
    INCOMPLETE_CONVERSION: number;
    MANUAL: number;
  };

  // === CONFIGURATION WATERFALL ===
  eligibleConfirmed: number;
  configExcludedConfirmed: number;
  configExcludedBreakdown: Array<{
    sourceCategory: string;
    configKey: string;
    configValue: boolean;
    count: number;
  }>;
  expectedPurchases: number;

  // === CANONICAL TRACKING RESULT ===
  canonicalPurchases: number;
  matchedPurchases: number;
  missingEligiblePurchases: number;
  unexpectedPurchases: number;
  dedupedPurchases: number;

  // === TRIGGER MODE BREAKDOWN ===
  instantPurchases: number;
  validatedPurchases: number;
  offlinePurchases: number;
  browserPurchases: number;
  replayedEvents: number;

  // === PROVIDER DELIVERY ===
  providerReconciliation: Array<{
    provider: string;
    expected: number;
    sent: number;
    pending: number;
    failed: number;
    skipped: number;
    missing: number;
  }>;

  // === DRILL-DOWN (order IDs for anomalies) ===
  missingOrderIds: string[];
  unexpectedOrderIds: string[];
  configExcludedOrderIds: Array<{ orderId: string; source: string; configKey: string }>;

  // === METADATA ===
  metaPurchaseMode: string;
  metaValidatedStatus: string;
  range: { from: string; to: string };
}

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

  /** Snapshot event volume by eventType over the date range. */
  async getVolumeByEventType(range: MonitoringDateRange): Promise<VolumeByEventTypeRow[]> {
    const rows = await this.prisma.trackingSnapshot.groupBy({
      by: ['eventType'],
      _count: true,
      where: { createdAt: { gte: range.from, lte: range.to } },
    });
    return rows.map((row) => ({ eventType: row.eventType, count: row._count }));
  }

  /** Per-provider dispatch funnel over the date range; every status defaulted to 0. */
  async getDispatchFunnel(provider: string, range: MonitoringDateRange): Promise<DispatchFunnel> {
    const rows = await this.prisma.trackingDispatch.groupBy({
      by: ['status'],
      _count: true,
      where: { provider, createdAt: { gte: range.from, lte: range.to } },
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
  async getRetryHistogram(range?: MonitoringDateRange): Promise<RetryHistogramRow[]> {
    const where: any = { attemptCount: { gt: 0 } };
    if (range) {
      where.createdAt = { gte: range.from, lte: range.to };
    }
    const rows = await this.prisma.trackingDispatch.groupBy({
      by: ['attemptCount'],
      _count: true,
      where,
    });
    return rows
      .map((row) => ({ attemptCount: row.attemptCount, count: row._count }))
      .sort((a, b) => a.attemptCount - b.attemptCount);
  }

  /** Most common terminal failure messages, truncated to a safe display length. */
  async getTopFailures(limit = 10, range?: MonitoringDateRange): Promise<TopFailureRow[]> {
    const where: any = {
      errorMsg: { not: null },
      status: { in: ['FAILED', 'DEAD'] },
    };
    if (range) {
      where.createdAt = { gte: range.from, lte: range.to };
    }
    const rows = await this.prisma.trackingDispatch.groupBy({
      by: ['errorMsg'],
      _count: true,
      where,
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
  async getFreshness(range: MonitoringDateRange): Promise<FreshnessStats> {
    const rows = await this.prisma.trackingOutbox.findMany({
      where: {
        dispatchedAt: { not: null },
        createdAt: { gte: range.from, lte: range.to },
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
  async getDedupKeyUsage(range: MonitoringDateRange): Promise<DedupKeyUsageRow[]> {
    const dateFilter = { gte: range.from, lte: range.to };
    const [eventIdCount, externalIdCount, fbpCount, fbcCount] = await Promise.all([
      this.prisma.trackingSnapshot.count({ where: { createdAt: dateFilter } }),
      this.prisma.trackingContext.count({
        where: { createdAt: dateFilter },
      }),
      this.prisma.trackingContext.count({
        where: {
          createdAt: dateFilter,
          identifiers: { path: ['meta', 'fbp', 'value'], not: Prisma.DbNull },
        },
      }),
      this.prisma.trackingContext.count({
        where: {
          createdAt: dateFilter,
          identifiers: { path: ['meta', 'fbc', 'value'], not: Prisma.DbNull },
        },
      }),
    ]);
    return [
      { key: 'event_id', events: eventIdCount },
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
  async getMirrorCapture(range: MonitoringDateRange): Promise<MirrorCaptureStats> {
    const dateFilter = { gte: range.from, lte: range.to };
    const [browserOrigin, total] = await Promise.all([
      this.prisma.trackingOutbox.count({
        where: {
          createdAt: dateFilter,
          configSnapshot: { path: ['source'], equals: 'browser' },
        },
      }),
      this.prisma.trackingOutbox.count({ where: { createdAt: dateFilter } }),
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
   * EMQ quality proxy (Wave-2.4 MON-2): share of windowed destination deliveries
   * flagged by the adapter's `match-key quality:` event (NO_EM_PH / NO_IDENTITY).
   * Schema-less (counts TrackingDispatchEvent), an internal at-risk rate — the
   * authoritative EMQ score is Meta's Dataset Quality API (out-of-band reader).
   */
  async getEmqProxy(range: MonitoringDateRange): Promise<EmqProxy> {
    const dateFilter = { gte: range.from, lte: range.to };
    const [qualityFlagged, windowedDispatches] = await Promise.all([
      this.prisma.trackingDispatchEvent.count({
        where: {
          createdAt: dateFilter,
          message: { startsWith: 'match-key quality:' },
        },
      }),
      this.prisma.trackingDispatch.count({
        where: { createdAt: dateFilter },
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
  async getQualityRates(range: MonitoringDateRange): Promise<QualityRates> {
    const dateFilter = { gte: range.from, lte: range.to };
    const [rows, retriedRows, windowedDispatches, replayed, emq, mirror] =
      await Promise.all([
        this.prisma.trackingDispatch.groupBy({
          by: ['status'],
          _count: true,
          where: { createdAt: dateFilter },
        }),
        this.prisma.trackingDispatch.count({
          where: { createdAt: dateFilter, attemptCount: { gt: 0 } },
        }),
        this.prisma.trackingDispatch.count({
          where: { createdAt: dateFilter },
        }),
        this.prisma.trackingDispatchEvent.count({
          where: { createdAt: dateFilter, message: 'replay' },
        }),
        this.getEmqProxy(range),
        this.getMirrorCapture(range),
      ]);
    const [dedupedCaptures, capturedSnapshots] = await Promise.all([
      this.prisma.trackingDispatchEvent.count({
        where: { createdAt: dateFilter, message: 'capture dedup' },
      }),
      this.prisma.trackingSnapshot.count({ where: { createdAt: dateFilter } }),
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
      retryRate: windowedDispatches > 0 ? retriedRows / windowedDispatches : 0,
      emq,
      mirror,
    };
  }

  /**
   * Identity/context field coverage over the window (2026-08-10 incident
   * follow-up). Counts, per canonical field, the share of windowed captures
   * carrying it.
   */
  async getIdentityCoverage(range: MonitoringDateRange): Promise<IdentityCoverageRow[]> {
    const dateFilter = { gte: range.from, lte: range.to };
    const snapshotBase = { createdAt: dateFilter } as const;
    const [em, ph, fn, ln, ct, st, zp, cn, ip, ua, base] = await Promise.all([
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'email'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'phone'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'firstName'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'lastName'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'city'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'state'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'zip'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingSnapshot.count({
        where: { ...snapshotBase, payload: { path: ['customer', 'country'], not: Prisma.DbNull } },
      }),
      this.prisma.trackingContext.count({
        where: { createdAt: dateFilter, ip: { not: '' } },
      }),
      this.prisma.trackingContext.count({
        where: { createdAt: dateFilter, userAgent: { not: '' } },
      }),
      this.prisma.trackingSnapshot.count({ where: snapshotBase }),
    ]);
    const rows: IdentityCoverageRow[] = [];
    const push = (field: string, baseOf: 'snapshot' | 'context', count: number, total: number) => {
      rows.push({ field, base: baseOf, count, total, coverage: total > 0 ? count / total : 0 });
    };
    push('email', 'snapshot', em, base);
    push('phone', 'snapshot', ph, base);
    push('firstName', 'snapshot', fn, base);
    push('lastName', 'snapshot', ln, base);
    push('city', 'snapshot', ct, base);
    push('state', 'snapshot', st, base);
    push('zip', 'snapshot', zp, base);
    push('country', 'snapshot', cn, base);
    const ctxBase = await this.prisma.trackingContext.count({ where: { createdAt: dateFilter } });
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
  async getWatchdog(range: MonitoringDateRange): Promise<WatchdogViolation[]> {
    const [health, quality, dead, coverage] = await Promise.all([
      this.getRuntimeHealth(),
      this.getQualityRates(range),
      this.getDeadStats(),
      this.getIdentityCoverage(range),
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
  async getHealthScore(range: MonitoringDateRange): Promise<HealthScore> {
    let score = 100;
    const penalties: HealthScore['penalties'] = [];
    const [violations, quality] = await Promise.all([
      this.getWatchdog(range),
      this.getQualityRates(range),
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

  /**
   * Windowed Purchase reconciliation waterfall (configuration-aware).
   *
   * Waterfall:
   *   Business Confirmed → Source Classification → Eligible/Excluded → Expected → Canonical → Matched/Missing/Unexpected
   *
   * Every number is traceable to order IDs via the drill-down arrays.
   */
  async getPurchaseReconciliation(range: MonitoringDateRange): Promise<PurchaseReconciliation> {
    const dateFilter = { gte: range.from, lte: range.to };

    // === STEP 1: Resolve configuration ===
    const [settings, sourceSettings] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'tracking_meta_purchase_mode',
              'tracking_meta_validated_status',
              'tracking_tiktok_purchase_mode',
              'tracking_tiktok_validated_status',
            ],
          },
        },
      }),
      this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'tracking_send_website_orders',
              'tracking_send_pos_orders',
              'tracking_send_incomplete_conversion_orders',
              'tracking_send_manual_orders',
            ],
          },
        },
      }),
    ]);

    const settingMap = Object.fromEntries(settings.map((s: any) => [s.key, s.value]));
    const sourceSettingMap = Object.fromEntries(sourceSettings.map((s: any) => [s.key, s.value]));
    const metaMode = settingMap['tracking_meta_purchase_mode'] || 'instant';
    const metaStatus = settingMap['tracking_meta_validated_status'] || '';

    // Source eligibility defaults
    const sourceEligibility: Record<string, boolean> = {
      DIRECT_WEBSITE: sourceSettingMap['tracking_send_website_orders'] !== 'false',
      POS: sourceSettingMap['tracking_send_pos_orders'] === 'true',
      INCOMPLETE_CONVERSION: sourceSettingMap['tracking_send_incomplete_conversion_orders'] === 'true',
      MANUAL: sourceSettingMap['tracking_send_manual_orders'] === 'true',
    };

    // === STEP 2: Business lifecycle metrics ===
    const newOrders = await this.prisma.order.count({
      where: { trashedAt: null, createdAt: dateFilter },
    });

    // Get all non-trashed orders and scan timeline for status transitions in range
    const allOrders = await this.prisma.order.findMany({
      where: { trashedAt: null },
      select: {
        id: true,
        timeline: true,
        source: true,
        salesChannel: true,
        sourcePlatform: true,
        sourceType: true,
        posSessionId: true,
        status: { select: { name: true } },
      },
    });

    // Classify each order's source
    function classifySource(order: any): string {
      if (order.posSessionId || order.source === 'POS') return 'POS';
      if (order.sourcePlatform === 'PHONE' || order.sourceType === 'CALL' || order.sourcePlatform === 'LEAD') return 'INCOMPLETE_CONVERSION';
      if (order.salesChannel && order.salesChannel !== 'WEBSITE' && order.salesChannel !== 'POS') return 'MANUAL';
      if (order.source && order.source !== 'ECOMMERCE' && order.source !== 'POS') return 'MANUAL';
      return 'DIRECT_WEBSITE';
    }

    // Scan timelines for Confirmed/Delivered transitions in range
    let confirmedOrders = 0;
    let deliveredOrders = 0;
    const confirmedBySource = { DIRECT_WEBSITE: 0, POS: 0, INCOMPLETE_CONVERSION: 0, MANUAL: 0 };
    const confirmedOrderDetails: Array<{ id: string; source: string; eligible: boolean; configKey: string; configValue: boolean }> = [];

    for (const order of allOrders) {
      const timeline = Array.isArray(order.timeline) ? order.timeline : [];
      let enteredConfirmed = false;
      let enteredDelivered = false;
      for (const entry of timeline) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as any;
        if (!e.timestamp || !e.status) continue;
        const t = new Date(e.timestamp);
        if (t < range.from || t > range.to) continue;
        if (e.status === 'Confirmed') enteredConfirmed = true;
        if (e.status === 'Delivered') enteredDelivered = true;
      }
      if (enteredConfirmed) {
        confirmedOrders++;
        const source = classifySource(order) as keyof typeof confirmedBySource;
        confirmedBySource[source]++;
        const eligible = sourceEligibility[source] ?? false;
        const configKey = source === 'DIRECT_WEBSITE' ? 'tracking_send_website_orders'
          : source === 'POS' ? 'tracking_send_pos_orders'
            : source === 'INCOMPLETE_CONVERSION' ? 'tracking_send_incomplete_conversion_orders'
              : 'tracking_send_manual_orders';
        confirmedOrderDetails.push({ id: order.id, source, eligible, configKey, configValue: eligible });
      }
      if (enteredDelivered) deliveredOrders++;
    }

    // === STEP 3: Configuration waterfall ===
    const eligibleConfirmed = confirmedOrderDetails.filter((d) => d.eligible).length;
    const configExcludedConfirmed = confirmedOrderDetails.filter((d) => !d.eligible).length;
    const configExcludedOrderIds = confirmedOrderDetails
      .filter((d) => !d.eligible)
      .map((d) => ({ orderId: d.id, source: d.source, configKey: d.configKey }));

    // Build exclusion breakdown by source category
    const exclusionCounts: Record<string, { configKey: string; configValue: boolean; count: number }> = {};
    for (const d of confirmedOrderDetails) {
      if (!d.eligible) {
        if (!exclusionCounts[d.source]) {
          exclusionCounts[d.source] = { configKey: d.configKey, configValue: false, count: 0 };
        }
        exclusionCounts[d.source].count++;
      }
    }
    const configExcludedBreakdown = Object.entries(exclusionCounts).map(([source, data]) => ({
      sourceCategory: source,
      ...data,
    }));

    // Expected Purchase = eligible confirmed orders (for validated/Confirmed mode)
    // or eligible new orders (for instant mode)
    let expectedPurchases: number;
    if (metaMode === 'validated' && metaStatus === 'Confirmed') {
      expectedPurchases = eligibleConfirmed;
    } else if (metaMode === 'validated' && metaStatus === 'Delivered') {
      // For validated/Delivered, count eligible orders that entered Delivered
      const eligibleDelivered = allOrders.filter((order) => {
        const source = classifySource(order);
        if (!sourceEligibility[source]) return false;
        const timeline = Array.isArray(order.timeline) ? order.timeline : [];
        return timeline.some((e: any) => {
          if (!e?.timestamp || !e?.status) return false;
          const t = new Date(e.timestamp);
          return t >= range.from && t <= range.to && e.status === 'Delivered';
        });
      }).length;
      expectedPurchases = eligibleDelivered;
    } else {
      // Instant mode: expected = eligible orders created in range
      const eligibleNewOrders = allOrders.filter((order) => {
        const source = classifySource(order);
        return sourceEligibility[source];
      }).length;
      expectedPurchases = eligibleNewOrders;
    }

    // === STEP 4: Canonical Purchase snapshots ===
    const purchaseSnapshots = await this.prisma.trackingSnapshot.findMany({
      where: { eventType: 'Purchase', createdAt: dateFilter },
      select: { id: true, eventId: true, orderId: true, payload: true, createdAt: true },
    });

    const canonicalPurchases = purchaseSnapshots.length;
    const purchaseOrderIds = new Set(purchaseSnapshots.map((s) => s.orderId).filter(Boolean) as string[]);
    const eligibleOrderIds = new Set(confirmedOrderDetails.filter((d) => d.eligible).map((d) => d.id));

    // For instant mode, eligible = all orders created in range (not just confirmed)
    // We need to check which orders have Purchase snapshots
    const allEligibleOrderIds = new Set<string>();
    for (const order of allOrders) {
      const source = classifySource(order);
      if (sourceEligibility[source]) {
        allEligibleOrderIds.add(order.id);
      }
    }

    // Matched = Purchase snapshots that correspond to eligible orders
    let matchedPurchases = 0;
    let unexpectedPurchases = 0;
    const missingOrderIds: string[] = [];
    const unexpectedOrderIds: string[] = [];

    // Check which eligible orders have Purchase snapshots
    const expectedOrderIds = metaMode === 'validated' && metaStatus ? eligibleOrderIds : allEligibleOrderIds;
    for (const orderId of expectedOrderIds) {
      if (purchaseOrderIds.has(orderId)) {
        matchedPurchases++;
      } else {
        missingOrderIds.push(orderId);
      }
    }

    // Check which Purchase snapshots don't correspond to eligible orders
    for (const snap of purchaseSnapshots) {
      if (snap.orderId && !expectedOrderIds.has(snap.orderId)) {
        unexpectedPurchases++;
        unexpectedOrderIds.push(snap.orderId);
      }
    }

    const missingEligiblePurchases = missingOrderIds.length;

    // Deduped = capture-level duplicates in range
    const dedupedCaptures = await this.prisma.trackingDispatchEvent.count({
      where: { createdAt: dateFilter, message: 'capture dedup' },
    });

    // Trigger mode breakdown
    let instantPurchases = 0;
    let validatedPurchases = 0;
    let offlinePurchases = 0;
    let browserPurchases = 0;
    for (const snap of purchaseSnapshots) {
      const payload = snap.payload as any;
      const triggerMode = payload?.triggerMode;
      if (triggerMode === 'instant') instantPurchases++;
      else if (triggerMode === 'validated') validatedPurchases++;
      else if (triggerMode === 'offline') offlinePurchases++;
      else if (triggerMode === 'browser') browserPurchases++;
    }

    const replayedEvents = await this.prisma.trackingDispatchEvent.count({
      where: { createdAt: dateFilter, message: 'replay' },
    });

    // === STEP 5: Provider delivery reconciliation ===
    const dispatchRows = await this.prisma.trackingDispatch.findMany({
      where: {
        eventId: { startsWith: 'purchase_' },
        createdAt: dateFilter,
      },
      select: { provider: true, destinationId: true, status: true, orderId: true },
    });

    const providerMap: Record<string, { expected: number; sent: number; pending: number; failed: number; skipped: number }> = {};
    for (const row of dispatchRows) {
      if (!providerMap[row.provider]) {
        providerMap[row.provider] = { expected: canonicalPurchases, sent: 0, pending: 0, failed: 0, skipped: 0 };
      }
      const p = providerMap[row.provider];
      if (row.status === 'SENT') p.sent++;
      else if (row.status === 'SKIPPED') p.skipped++;
      else if (row.status === 'FAILED' || row.status === 'DEAD') p.failed++;
      else p.pending++;
    }

    const providerReconciliation = Object.entries(providerMap).map(([provider, data]) => ({
      provider,
      ...data,
      missing: Math.max(0, data.expected - data.sent - data.pending - data.failed),
    }));

    return {
      newOrders,
      confirmedOrders,
      deliveredOrders,
      confirmedBySource,
      eligibleConfirmed,
      configExcludedConfirmed,
      configExcludedBreakdown,
      expectedPurchases,
      canonicalPurchases,
      matchedPurchases,
      missingEligiblePurchases,
      unexpectedPurchases,
      dedupedPurchases: dedupedCaptures,
      instantPurchases,
      validatedPurchases,
      offlinePurchases,
      browserPurchases,
      replayedEvents,
      providerReconciliation,
      missingOrderIds,
      unexpectedOrderIds,
      configExcludedOrderIds,
      metaPurchaseMode: metaMode,
      metaValidatedStatus: metaStatus,
      range: { from: range.fromStr, to: range.toStr },
    };
  }

  private cutoff(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }
}
