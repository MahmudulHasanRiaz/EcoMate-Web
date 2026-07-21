import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityEventSeverity, SecurityEventCategory, SecurityActorType } from '@prisma/client';
import type {
  DashboardSummary,
  EventTimelineResponse,
  SecurityEventItem,
  TrendResponse,
  TrendDataPoint,
  TopOffendersResponse,
  TopOffender,
  BlockActivityResponse,
  BlockActivityPoint,
  RetentionConfigResponse,
  RetentionPolicyItem,
  EventDetailResponse,
  CorrelationNode,
} from '../interfaces/dashboard-data.interface';

/**
 * Read-only query service for the Security Dashboard.
 * Every query hits aggregate tables or optimized raw-event queries.
 * Never blocks or touches production request paths.
 */
@Injectable()
export class DashboardQueryService {
  private readonly logger = new Logger(DashboardQueryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Summary ─────────────────────────────────────────────────────

  async getSummary(): Promise<DashboardSummary> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayAgo = new Date(now.getTime() - 86400000);

    const [
      totalEvents1h,
      totalEvents24h,
      activeBlocks,
      autoBlocks24h,
      criticalEvents24h,
      topEventTypeResult,
    ] = await Promise.all([
      this.prisma.securityEvent.count({
        where: { timestamp: { gte: oneHourAgo } },
      }),
      this.prisma.securityEvent.count({
        where: { timestamp: { gte: oneDayAgo } },
      }),
      this.getActiveBlockCount(),
      this.getAutoBlockCount24h(oneDayAgo),
      this.prisma.securityEvent.count({
        where: {
          timestamp: { gte: oneDayAgo },
          severity: SecurityEventSeverity.CRITICAL,
        },
      }),
      this.getTopEventType24h(oneDayAgo),
    ]);

    return {
      totalEvents1h,
      totalEvents24h,
      activeBlocks,
      autoBlocks24h,
      criticalEvents24h,
      topEventType: topEventTypeResult,
      redisStatus: 'connected', // Gateway will override this from RateLimitCounterService
    };
  }

  private async getActiveBlockCount(): Promise<number> {
    const [ipCount, phoneCount] = await Promise.all([
      this.prisma.blockedIp.count({
        where: { isActive: true },
      }),
      this.prisma.blockedPhone.count({
        where: { isActive: true },
      }),
    ]);
    return ipCount + phoneCount;
  }

  private async getAutoBlockCount24h(since: Date): Promise<number> {
    return this.prisma.securityEvent.count({
      where: {
        eventType: 'auto_block_created',
        timestamp: { gte: since },
      },
    });
  }

  private async getTopEventType24h(
    since: Date,
  ): Promise<{ eventType: string; count: number } | null> {
    const result = await this.prisma.securityEventDaily.findFirst({
      where: { date: { gte: since } },
      orderBy: { count: 'desc' },
    });
    return result ? { eventType: result.eventType, count: result.count } : null;
  }

  // ─── Timeline ────────────────────────────────────────────────────

  async getTimeline(
    limit: number,
    cursor?: string,
    filters?: {
      severity?: SecurityEventSeverity;
      category?: SecurityEventCategory;
      eventType?: string;
    },
  ): Promise<EventTimelineResponse> {
    const where: any = {};
    if (filters?.severity) where.severity = filters.severity;
    if (filters?.category) where.category = filters.category;
    if (filters?.eventType) where.eventType = filters.eventType;
    if (cursor) {
      const cursorEvent = await this.prisma.securityEvent.findUnique({
        where: { id: cursor },
        select: { timestamp: true },
      });
      if (cursorEvent) {
        where.timestamp = { lt: cursorEvent.timestamp };
      }
    }

    const pageSize = Math.min(limit || 50, 100);

    const [events, total] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: pageSize + 1,
        select: {
          id: true,
          eventType: true,
          severity: true,
          category: true,
          source: true,
          timestamp: true,
          actorType: true,
          ipAddress: true,
          userId: true,
          description: true,
          riskScore: true,
          correlationId: true,
        },
      }),
      this.prisma.securityEvent.count({ where }),
    ]);

    const hasMore = events.length > pageSize;
    if (hasMore) events.pop();

    return {
      items: events.map(this.mapToTimelineItem),
      total,
      page: cursor ? -1 : 1,
      pageSize,
    };
  }

  private mapToTimelineItem(e: any): SecurityEventItem {
    return {
      id: e.id,
      eventType: e.eventType,
      severity: e.severity,
      category: e.category,
      source: e.source,
      timestamp: e.timestamp.toISOString(),
      actorType: e.actorType,
      ipAddress: e.ipAddress,
      userId: e.userId,
      description: e.description,
      riskScore: e.riskScore,
      correlationId: e.correlationId,
    };
  }

  // ─── Trends ──────────────────────────────────────────────────────

  async getTrends(
    interval: 'hourly' | 'daily',
    from: Date,
    to: Date,
    filters?: {
      severity?: SecurityEventSeverity;
      eventType?: string;
      category?: SecurityEventCategory;
    },
  ): Promise<TrendResponse> {
    const where: any = {};
    if (interval === 'hourly') {
      where.bucket = { gte: from, lte: to };
    } else {
      where.date = { gte: from, lte: to };
    }
    if (filters?.severity) where.severity = filters.severity;
    if (filters?.eventType) where.eventType = filters.eventType;
    if (filters?.category) where.category = filters.category;

    const data =
      interval === 'hourly'
        ? await this.prisma.securityEventHourly.findMany({
            where,
            orderBy: { bucket: 'asc' },
          })
        : await this.prisma.securityEventDaily.findMany({
            where,
            orderBy: { date: 'asc' },
          });

    return {
      data: data.map((d) => ({
        bucket:
          interval === 'hourly'
            ? (d as any).bucket.toISOString()
            : (d as any).date.toISOString(),
        count: d.count,
        severity: d.severity,
        eventType: d.eventType,
      })),
      interval,
    };
  }

  // ─── Top Offenders ───────────────────────────────────────────────

  async getTopOffenders(
    window: '1h' | '24h' | '7d' = '24h',
    limit = 10,
    actorType?: SecurityActorType,
  ): Promise<TopOffendersResponse> {
    const windowMs =
      window === '1h' ? 3600000 : window === '24h' ? 86400000 : 604800000;
    const since = new Date(Date.now() - windowMs);

    const actorFilter = actorType ? `AND "actorType"::text = '${actorType}'` : '';

    const rows: Array<{ actorType: string; actorId: string; count: number; lastSeen: string }> =
      await this.prisma.$queryRawUnsafe(`
        SELECT
          "actorType"::text as "actorType",
          COALESCE("ipAddress", "userId", 'unknown') as "actorId",
          COUNT(*)::int as count,
          MAX("timestamp")::text as "lastSeen"
        FROM "SecurityEvent"
        WHERE "timestamp" >= $1
          AND ("ipAddress" IS NOT NULL OR "userId" IS NOT NULL)
          ${actorFilter}
        GROUP BY "actorType", COALESCE("ipAddress", "userId", 'unknown')
        ORDER BY count DESC
        LIMIT $2
      `, since, limit);

    return {
      items: rows.map((r) => ({
        actorType: r.actorType as SecurityActorType,
        actorId: r.actorId,
        count: r.count,
        lastSeen: r.lastSeen,
      })),
      window,
    };
  }

  // ─── Block Activity ──────────────────────────────────────────────

  async getBlockActivity(
    from: Date,
    to: Date,
  ): Promise<BlockActivityResponse> {
    const rows = await this.prisma.securityBlockDaily.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    // Group by date
    const grouped = new Map<
      string,
      { autoBlocks: number; manualBlocks: number; ipBlocks: number; phoneBlocks: number }
    >();

    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      const entry = grouped.get(key) || {
        autoBlocks: 0,
        manualBlocks: 0,
        ipBlocks: 0,
        phoneBlocks: 0,
      };
      if (row.blockSource === 'auto') entry.autoBlocks += row.count;
      else entry.manualBlocks += row.count;
      if (row.targetType === 'ip') entry.ipBlocks += row.count;
      else entry.phoneBlocks += row.count;
      grouped.set(key, entry);
    }

    return {
      data: Array.from(grouped.entries()).map(([date, counts]) => ({
        date,
        ...counts,
      })),
      interval: 'daily',
    };
  }

  // ─── Event Detail ────────────────────────────────────────────────

  async getEventDetail(id: string): Promise<EventDetailResponse | null> {
    const event = await this.prisma.securityEvent.findUnique({
      where: { id },
    });
    if (!event) return null;

    return {
      id: event.id,
      eventType: event.eventType,
      severity: event.severity,
      category: event.category,
      source: event.source,
      timestamp: event.timestamp.toISOString(),
      actorType: event.actorType,
      ipAddress: event.ipAddress,
      userId: event.userId,
      sessionId: event.sessionId,
      browserTrustId: event.browserTrustId,
      phone: event.phone,
      trustTier: event.trustTier,
      description: event.description,
      riskScore: event.riskScore ?? null,
      metadata: event.metadata as Record<string, unknown> | null,
      metadataVersion: event.metadataVersion,
      correlationId: event.correlationId,
      parentCorrelationId: event.parentCorrelationId,
      retentionOverride: event.retentionOverride,
      createdAt: event.createdAt.toISOString(),
    };
  }

  // ─── Correlation Chain ───────────────────────────────────────────

  async getCorrelationChain(
    correlationId: string,
  ): Promise<CorrelationNode[]> {
    const events = await this.prisma.securityEvent.findMany({
      where: {
        OR: [
          { correlationId },
          { parentCorrelationId: correlationId },
          { id: correlationId },
        ],
      },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        eventType: true,
        severity: true,
        timestamp: true,
        description: true,
        correlationId: true,
        parentCorrelationId: true,
      },
    });

    return events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      severity: e.severity,
      timestamp: e.timestamp.toISOString(),
      description: e.description,
      depth: e.parentCorrelationId === correlationId || e.correlationId === correlationId ? 0 : 1,
    }));
  }

  // ─── Retention Config ────────────────────────────────────────────

  async getRetentionConfig(): Promise<RetentionConfigResponse> {
    const policies = await this.prisma.securityRetentionPolicy.findMany();
    return {
      policies: policies.map((p) => ({
        id: p.id,
        category: p.category,
        severity: p.severity,
        retentionDays: p.retentionDays,
        criticalRetentionDays: p.criticalRetentionDays,
      })),
    };
  }

  async updateRetentionPolicy(
    category: SecurityEventCategory,
    severity: SecurityEventSeverity,
    data: { retentionDays: number; criticalRetentionDays?: number | null },
  ): Promise<RetentionPolicyItem> {
    const policy = await this.prisma.securityRetentionPolicy.upsert({
      where: {
        tenant_category_severity: {
          tenant: 'default',
          category,
          severity,
        },
      },
      create: {
        tenant: 'default',
        category,
        severity,
        retentionDays: data.retentionDays,
        criticalRetentionDays: data.criticalRetentionDays ?? null,
      },
      update: {
        retentionDays: data.retentionDays,
        criticalRetentionDays: data.criticalRetentionDays ?? null,
      },
    });

    return {
      id: policy.id,
      category: policy.category,
      severity: policy.severity,
      retentionDays: policy.retentionDays,
      criticalRetentionDays: policy.criticalRetentionDays,
    };
  }
}
