import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { buildAdapterRegistry } from './adapters';
import { DispatchFunnel, MonitoringService } from './monitoring.service';
import {
  MonitoringDateRange,
  validateDateRange,
  buildPresetRange,
} from './dto/monitoring.dto';
import { dhakaDateString } from '../common/utils/dhaka-time';

/** Ops-dashboard window cap: a week back, anything more is a misconfigured query. */
const MAX_HOURS = 168;

/** Sanity bound on the top-failures list; the service default is 10. */
const MAX_LIMIT = 100;

/**
 * Admin monitoring endpoints (Phase 6, design §14). Read-only aggregate/sanitized
 * views over the tracking tables for the ops dashboard — no PII, no tokens, no
 * writes. Aggregates delegate to MonitoringService; the per-event timeline is a
 * direct Prisma read of TrackingDispatchEvent (the append-only lifecycle log).
 * Guarded identically to the replay controller: admin-only + admin_tracking
 * feature gate, enforced at the class level.
 */
@Controller('tracking/admin/monitoring')
@Roles('admin')
@RequiresFeature('admin_tracking')
export class MonitoringController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolve the date range from query parameters.
   * Supports both legacy `hours` parameter and new `from`/`to` or `preset` parameters.
   * Returns a MonitoringDateRange with absolute UTC instants for Dhaka-day boundaries.
   */
  private resolveRange(
    from?: string,
    to?: string,
    preset?: string,
    hours?: string,
  ): MonitoringDateRange {
    // Priority: preset > from/to > hours > default (today)
    if (preset) {
      const validPresets = ['today', 'yesterday', 'last7days'];
      if (!validPresets.includes(preset)) {
        throw new BadRequestException(
          `Invalid preset: "${preset}". Valid presets: ${validPresets.join(', ')}`,
        );
      }
      return buildPresetRange(preset as 'today' | 'yesterday' | 'last7days');
    }
    if (from && to) {
      return validateDateRange(from, to);
    }
    // Legacy hours support: convert to date range
    if (hours) {
      const h = this.hoursParam(hours);
      const now = new Date();
      const fromMs = now.getTime() - h * 60 * 60 * 1000;
      const fromDate = new Date(fromMs);
      const fromStr = dhakaDateString(fromDate);
      const toStr = dhakaDateString(now);
      return validateDateRange(fromStr, toStr);
    }
    // Default: today
    return buildPresetRange('today');
  }

  /**
   * Snapshot volume by eventType + per-provider dispatch funnel + DEAD/DLQ stats.
   * The funnel is aggregated across every provider the adapter registry knows, so
   * a newly registered provider appears on the dashboard without a code change.
   */
  @Get('overview')
  async overview(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    const providers = buildAdapterRegistry().map((adapter) => adapter.provider);
    const [volumeByEventType, deadStats, relayHealth, ...funnels] =
      await Promise.all([
        this.monitoring.getVolumeByEventType(range),
        this.monitoring.getDeadStats(),
        this.monitoring.getRelayHealth(),
        ...providers.map((provider) =>
          this.monitoring.getDispatchFunnel(provider, range),
        ),
      ]);
    const dispatchFunnel: Record<string, DispatchFunnel> = {};
    providers.forEach((provider, i) => {
      dispatchFunnel[provider] = funnels[i];
    });
    return { volumeByEventType, dispatchFunnel, deadStats, relayHealth, range: { from: range.fromStr, to: range.toStr } };
  }

  /**
   * Runtime health across the four layers (Wave-1): relay (outbox backlog),
   * Redis (queue connectivity), BullMQ worker (job counts), dispatcher (sending
   * rows). This is the alert source for a stalled pipeline.
   */
  @Get('health')
  async health() {
    const {
      relay: relayHealth,
      redis: redisHealth,
      queue: queueHealth,
      dispatcher: dispatcherHealth,
    } = await this.monitoring.getRuntimeHealth();
    return { relayHealth, redisHealth, queueHealth, dispatcherHealth };
  }

  /**
   * Browser-mirror capture ratio over the window (Wave-1 correction #3) — the
   * share of captured events that arrived via the browser mirror. NOT Meta
   * coverage (that metric lives in Events Manager).
   */
  @Get('mirror-capture')
  async mirrorCapture(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    return {
      mirrorCapture: await this.monitoring.getMirrorCapture(range),
    };
  }

  /**
   * EMQ quality proxy (Wave-2.4 MON-2): share of dispatches flagged for a
   * match-key gap (NO_EM_PH / NO_IDENTITY). Internal at-risk rate; the
   * authoritative EMQ score is Meta's Dataset Quality API.
   */
  @Get('emq')
  async emq(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    return { emq: await this.monitoring.getEmqProxy(range) };
  }

  /**
   * Consolidated dispatch-quality rates (Wave-2.4 MON-3): terminal funnel,
   * replay volume, dedup/retry rates, EMQ + mirror proxies in one view.
   */
  @Get('quality')
  async quality(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    return {
      quality: await this.monitoring.getQualityRates(range),
    };
  }

  /**
   * Watchdog alerts (Wave-2.4 MON-4): actionable violations with severity —
   * critical (pipeline down/stalled), warning (elevated, self-healing), info
   * (configuration state). The alert source for the ops dashboard.
   */
  @Get('watchdog')
  async watchdog(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    return {
      violations: await this.monitoring.getWatchdog(range),
    };
  }

  /**
   * Composite 0-100 health score + grade (Wave-2.4 MON-4), derived from the
   * watchdog penalties — a single-page drift signal with drill-down.
   */
  @Get('health-score')
  async healthScore(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    return {
      healthScore: await this.monitoring.getHealthScore(range),
    };
  }

  /** Most common terminal failure reasons + the attempt-count distribution. */
  @Get('failures')
  async failures(@Query('limit') limit?: string) {
    const top = this.limitParam(limit);
    const [topFailures, retryHistogram] = await Promise.all([
      this.monitoring.getTopFailures(top),
      this.monitoring.getRetryHistogram(),
    ]);
    return { topFailures, retryHistogram };
  }

  /** Capture -> dispatch latency (avg + p95) over dispatched outboxes. */
  @Get('freshness')
  async freshness(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    const { avgCaptureToDispatchSec, p95CaptureToDispatchSec } =
      await this.monitoring.getFreshness(range);
    return { avgCaptureToDispatchSec, p95CaptureToDispatchSec };
  }

  /**
   * Purchase reconciliation (exactly-once observability): qualifying orders vs
   * canonical Purchase events vs unique eventIds vs per-provider delivery rows.
   * Every Purchase is traceable by orderId + eventId via `timeline`.
   * Now windowed by date range (Phase 5+10 upgrade).
   */
  @Get('purchase-reconciliation')
  async purchaseReconciliation(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    return {
      reconciliation: await this.monitoring.getPurchaseReconciliation(range),
    };
  }

  /** CAPI dedup-key usage over the window (event_id/external_id snapshots, fbp/fbc contexts). */
  @Get('dedup')
  async dedup(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    const keyUsage = await this.monitoring.getDedupKeyUsage(range);
    return { keyUsage };
  }

  /**
   * Identity/context field coverage over the window (2026-08-10 incident
   * follow-up): share of captures carrying em/ph/fn/ln/ct/st/zp/country (JSON
   * payload paths) and ip/userAgent (context columns). Server-side truth for
   * the Meta-side coverage survey.
   */
  @Get('coverage')
  async coverage(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preset') preset?: string,
    @Query('hours') hours?: string,
  ) {
    const range = this.resolveRange(from, to, preset, hours);
    return {
      identityCoverage: await this.monitoring.getIdentityCoverage(range),
    };
  }

  /**
   * Full lifecycle of one event: the TrackingDispatchEvent rows (capture -> relay
   * -> each provider attempt -> terminal, ascending) plus the snapshot eventType
   * and the current outbox status for context.
   */
  @Get('timeline')
  async timeline(@Query('eventId') eventId?: string) {
    if (!eventId) throw new BadRequestException('eventId is required');
    const snapshot = await this.prisma.trackingSnapshot.findUnique({
      where: { eventId },
      select: { id: true, eventType: true },
    });
    const [events, outbox] = await Promise.all([
      this.prisma.trackingDispatchEvent.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
      }),
      snapshot
        ? this.prisma.trackingOutbox.findUnique({
            where: { snapshotId: snapshot.id },
            select: { status: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      eventType: snapshot?.eventType ?? null,
      status: outbox?.status ?? null,
      events,
    };
  }

  /** Positive-integer hours, default 24, capped at MAX_HOURS; malformed -> 400. */
  private hoursParam(raw?: string): number {
    return this.positiveIntParam(raw, 24, MAX_HOURS, 'hours');
  }

  /** Positive-integer limit, default 10, capped at MAX_LIMIT; malformed -> 400. */
  private limitParam(raw?: string): number {
    return this.positiveIntParam(raw, 10, MAX_LIMIT, 'limit');
  }

  private positiveIntParam(raw: string | undefined, fallback: number, cap: number, name: string): number {
    const parsed = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    return Math.min(parsed, cap);
  }
}
