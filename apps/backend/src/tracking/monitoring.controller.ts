import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { buildAdapterRegistry } from './adapters';
import { DispatchFunnel, MonitoringService } from './monitoring.service';

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
   * Snapshot volume by eventType + per-provider dispatch funnel + DEAD/DLQ stats.
   * The funnel is aggregated across every provider the adapter registry knows, so
   * a newly registered provider appears on the dashboard without a code change.
   */
  @Get('overview')
  async overview(@Query('hours') hours?: string) {
    const window = this.hoursParam(hours);
    const providers = buildAdapterRegistry().map((adapter) => adapter.provider);
    const [volumeByEventType, deadStats, relayHealth, ...funnels] =
      await Promise.all([
        this.monitoring.getVolumeByEventType(window),
        this.monitoring.getDeadStats(),
        this.monitoring.getRelayHealth(),
        ...providers.map((provider) =>
          this.monitoring.getDispatchFunnel(provider, window),
        ),
      ]);
    const dispatchFunnel: Record<string, DispatchFunnel> = {};
    providers.forEach((provider, i) => {
      dispatchFunnel[provider] = funnels[i];
    });
    return { volumeByEventType, dispatchFunnel, deadStats, relayHealth };
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
  async mirrorCapture(@Query('hours') hours?: string) {
    return {
      mirrorCapture: await this.monitoring.getMirrorCapture(this.hoursParam(hours)),
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
  async freshness(@Query('hours') hours?: string) {
    const { avgCaptureToDispatchSec, p95CaptureToDispatchSec } =
      await this.monitoring.getFreshness(this.hoursParam(hours));
    return { avgCaptureToDispatchSec, p95CaptureToDispatchSec };
  }

  /** CAPI dedup-key usage over the window (event_id/external_id snapshots, fbp/fbc contexts). */
  @Get('dedup')
  async dedup(@Query('hours') hours?: string) {
    const keyUsage = await this.monitoring.getDedupKeyUsage(this.hoursParam(hours));
    return { keyUsage };
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
