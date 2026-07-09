import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getSalesKpi(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:sales-kpi:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = this.dateFilter(startDate, endDate);
    const refundFilter = this.dateFilter(startDate, endDate, 'createdAt');

    const [orderAgg, revenueAgg, refundAgg] = await Promise.all([
      this.prisma.order.aggregate({
        _count: true,
        _sum: { total: true },
        where: { ...dateFilter },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { ...dateFilter, status: 'PAID' },
      }),
      this.prisma.refund.aggregate({
        _sum: { amount: true },
        where: { ...refundFilter, status: 'completed' },
      }),
    ]);

    const totalRevenue = Number(revenueAgg._sum.amount || 0);
    const totalOrders = orderAgg._count;
    const totalRefunds = Number(refundAgg._sum.amount || 0);
    const aov =
      totalOrders > 0
        ? Math.round((totalRevenue / totalOrders) * 100) / 100
        : 0;
    const refundRate =
      totalRevenue > 0
        ? Math.round((totalRefunds / totalRevenue) * 10000) / 100
        : 0;

    const result = { totalRevenue, totalOrders, aov, refundRate, totalRefunds };
    await this.cache.set(cacheKey, result, 300_000);
    return result;
  }

  async getRevenueTrend(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:revenue-trend:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { start, end } = this.getDateRange(startDate, endDate);
    type Row = { date: string; revenue: string };
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT DATE(p."createdAt" AT TIME ZONE 'Asia/Dhaka')::text AS date,
              SUM(p.amount)::text AS revenue
       FROM "Payment" p
       WHERE p.status = 'PAID'
         AND ($1::timestamptz IS NULL OR p."createdAt" >= $1)
         AND ($2::timestamptz IS NULL OR p."createdAt" <= $2)
       GROUP BY DATE(p."createdAt" AT TIME ZONE 'Asia/Dhaka')
       ORDER BY date ASC`,
      start,
      end,
    );

    const result = {
      data: rows.map((r) => ({ date: r.date, revenue: Number(r.revenue) })),
    };
    await this.cache.set(cacheKey, result, 300_000);
    return result;
  }

  async getMarketingKpi(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:marketing-kpi:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { start, end } = this.getDateRange(startDate, endDate);
    type CountRow = { count: string };
    type SessionsRow = { sessionId: string; cnt: string };

    const [pageViews, visitors, sessionsRaw] = await Promise.all([
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*)::text AS count FROM "PageView"
         WHERE ($1::timestamptz IS NULL OR "timestamp" >= $1)
           AND ($2::timestamptz IS NULL OR "timestamp" <= $2)`,
        start,
        end,
      ),
      this.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(DISTINCT "sessionId")::text AS count FROM "PageView"
         WHERE "sessionId" IS NOT NULL
           AND ($1::timestamptz IS NULL OR "timestamp" >= $1)
           AND ($2::timestamptz IS NULL OR "timestamp" <= $2)`,
        start,
        end,
      ),
      this.prisma.$queryRawUnsafe<SessionsRow[]>(
        `SELECT "sessionId", COUNT(*)::text AS cnt FROM "PageView"
         WHERE "sessionId" IS NOT NULL
           AND ($1::timestamptz IS NULL OR "timestamp" >= $1)
           AND ($2::timestamptz IS NULL OR "timestamp" <= $2)
         GROUP BY "sessionId"`,
        start,
        end,
      ),
    ]);

    const pv = Number(pageViews[0]?.count || 0);
    const uv = Number(visitors[0]?.count || 0);
    const sessions = sessionsRaw.length;
    const bounceSessions = sessionsRaw.filter(
      (s) => Number(s.cnt) === 1,
    ).length;
    const bounceRate =
      sessions > 0 ? Math.round((bounceSessions / sessions) * 10000) / 100 : 0;
    const pagesPerSession =
      sessions > 0 ? Math.round((pv / sessions) * 100) / 100 : 0;

    const result = {
      pageViews: pv,
      uniqueVisitors: uv,
      bounceRate,
      pagesPerSession,
    };
    await this.cache.set(cacheKey, result, 900_000);
    return result;
  }

  async getTrafficSources(startDate?: string, endDate?: string) {
    const cacheKey = `analytics:traffic-sources:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { start, end } = this.getDateRange(startDate, endDate);
    type Row = { source: string; visits: string };
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT COALESCE("source", 'direct') AS source, COUNT(*)::text AS visits
       FROM "PageView"
       WHERE ($1::timestamptz IS NULL OR "timestamp" >= $1)
         AND ($2::timestamptz IS NULL OR "timestamp" <= $2)
       GROUP BY "source"
       ORDER BY visits DESC`,
      start,
      end,
    );

    const total = rows.reduce((s, r) => s + Number(r.visits), 0);
    const sources = rows.map((r) => ({
      source: r.source,
      visits: Number(r.visits),
      percentage:
        total > 0 ? Math.round((Number(r.visits) / total) * 10000) / 100 : 0,
    }));

    const result = { sources };
    await this.cache.set(cacheKey, result, 900_000);
    return result;
  }

  private dateFilter(
    startDate?: string,
    endDate?: string,
    field: string = 'createdAt',
  ): Record<string, any> {
    if (!startDate && !endDate) return {};
    const filter: Record<string, any> = {};
    if (startDate)
      filter[field] = { ...filter[field], gte: new Date(startDate) };
    if (endDate) {
      filter[field] = {
        ...filter[field],
        lte: endDate.includes('T')
          ? new Date(endDate)
          : new Date(endDate + 'T23:59:59.999Z'),
      };
    }
    return filter;
  }

  private getDateRange(startDate?: string, endDate?: string) {
    return {
      start: startDate ? new Date(startDate) : null,
      end: endDate
        ? endDate.includes('T')
          ? new Date(endDate)
          : new Date(endDate + 'T23:59:59.999Z')
        : null,
    };
  }
}
