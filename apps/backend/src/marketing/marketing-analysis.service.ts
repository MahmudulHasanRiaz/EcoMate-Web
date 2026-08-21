import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingAllocationService } from './marketing-allocation.service';

@Injectable()
export class MarketingAnalysisService {
  constructor(
    private prisma: PrismaService,
    private allocation: MarketingAllocationService,
  ) {}

  private range(fromDate?: string, toDate?: string) {
    const now = new Date();
    const to = toDate
      ? new Date(`${toDate}T23:59:59.999Z`)
      : new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    const from = fromDate ? new Date(`${fromDate}T00:00:00Z`) : new Date(to);
    if (!fromDate) from.setDate(from.getDate() - 29);
    return { from, to };
  }

  /**
   * Platform-level KPIs for the period. Spend/orders/revenue all come from
   * immutable recorded rows (insights + attributions + allocations) — never
   * live-calculated from the provider, so the numbers are reproducible.
   */
  async kpis(fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);

    const [spend, orderRows, allocationStats] = await Promise.all([
      this.prisma.marketingCampaignInsight.aggregate({
        _sum: { spend: true, impressions: true, clicks: true, purchases: true, purchaseValue: true },
        where: { date: { gte: from, lte: to } },
      }),
      this.prisma.orderAttribution.findMany({
        where: { attributedAt: { gte: from, lte: to } },
        select: { order: { select: { total: true } } },
      }),
      this.prisma.marketingCostAllocation.aggregate({
        _sum: { allocatedCost: true },
        where: { calculatedAt: { gte: from, lte: to } },
      }),
    ]);

    const platformSpend = Number(spend._sum.spend ?? 0);
    const platformPurchases = Number(spend._sum.purchases ?? 0);
    const platformPurchaseValue = Number(spend._sum.purchaseValue ?? 0);
    const storeOrders = orderRows.length;
    const storeRevenue = orderRows.reduce((s, r) => s + Number(r.order.total), 0);
    const marketingCost = Number(allocationStats._sum.allocatedCost ?? 0);

    return {
      range: { from, to },
      platform: {
        spend: platformSpend,
        impressions: Number(spend._sum.impressions ?? 0),
        clicks: Number(spend._sum.clicks ?? 0),
        purchases: platformPurchases,
        purchaseValue: platformPurchaseValue,
        roas:
          platformSpend > 0
            ? Math.round((platformPurchaseValue / platformSpend) * 100) / 100
            : null,
        aov:
          platformPurchases > 0
            ? Math.round((platformPurchaseValue / platformPurchases) * 100) / 100
            : null,
      },
      store: {
        orders: storeOrders,
        revenue: storeRevenue,
        marketingCost,
        grossProfit: Math.round((storeRevenue - marketingCost) * 100) / 100,
        roas: marketingCost > 0 ? Math.round((storeRevenue / marketingCost) * 100) / 100 : null,
        aov: storeOrders > 0 ? Math.round((storeRevenue / storeOrders) * 100) / 100 : null,
      },
    };
  }

  /**
   * Per-campaign performance in the period: spend (BDT via FIFO consumption),
   * attributed orders, revenue and store-side ROAS.
   */
  async campaignPerformance(campaignId: string, fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);

    const campaign = await this.prisma.marketingCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const [insights, consumptions, attributions] = await Promise.all([
      this.prisma.marketingCampaignInsight.aggregate({
        _sum: { spend: true, impressions: true, clicks: true, purchases: true, purchaseValue: true },
        where: { campaignId, date: { gte: from, lte: to } },
      }),
      this.prisma.marketingConsumption.aggregate({
        _sum: { calculatedCost: true, consumedAmount: true },
        where: { campaignId, spendDate: { gte: from, lte: to } },
      }),
      this.prisma.orderAttribution.findMany({
        where: {
          campaignId,
          order: { createdAt: { gte: from, lte: to } },
        },
        select: { order: { select: { total: true, createdAt: true } } },
      }),
    ]);

    const spend = Number(insights._sum.spend ?? 0);
    const spendCost = Number(consumptions._sum.calculatedCost ?? 0);
    const orders = attributions.length;
    const revenue = attributions.reduce((sum, a) => sum + Number(a.order.total), 0);

    // Campaign verdict: Profitable / Near Break-even / Loss-making / Insufficient Data
    let verdict: 'profitable' | 'near_break_even' | 'loss_making' | 'insufficient_data' = 'insufficient_data';
    if (orders >= 5) {
      const profit = revenue - spendCost;
      const margin = revenue > 0 ? profit / revenue : 0;
      if (profit > 0 && margin > 0.1) verdict = 'profitable';
      else if (profit > 0 || margin >= -0.1) verdict = 'near_break_even';
      else verdict = 'loss_making';
    }

    return {
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      verdict,
      platform: {
        spend,
        impressions: Number(insights._sum.impressions ?? 0),
        clicks: Number(insights._sum.clicks ?? 0),
        purchases: Number(insights._sum.purchases ?? 0),
        purchaseValue: Number(insights._sum.purchaseValue ?? 0),
        roas:
          spend > 0
            ? Math.round((Number(insights._sum.purchaseValue ?? 0) / spend) * 100) / 100
            : null,
      },
      store: {
        orders,
        revenue: Math.round(revenue * 100) / 100,
        marketingCost: Math.round(spendCost * 100) / 100,
        profit: Math.round((revenue - spendCost) * 100) / 100,
        roas: spendCost > 0 ? Math.round((revenue / spendCost) * 100) / 100 : null,
        aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : null,
      },
    };
  }

  /**
   * Period-over-period overview for the top of the dashboard: this vs previous
   * equal-length window. `period` controls the series bucketing — day keeps
   * one point per row, week/month/quarter/year aggregate rows into labelled
   * buckets with explicit start/end bounds.
   */
  async periodOverview(fromDate?: string, toDate?: string, period: string = 'day') {
    const periods = ['day', 'week', 'month', 'quarter', 'year'];
    if (!periods.includes(period)) {
      throw new BadRequestException(
        `Invalid period '${period}'. Expected one of: ${periods.join(', ')}`,
      );
    }
    const { from, to } = this.range(fromDate, toDate);
    const lengthMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime());
    const prevFrom = new Date(prevTo.getTime() - lengthMs);

    const rows = await this.prisma.marketingDailySummary.findMany({
      where: { date: { gte: prevFrom, lte: to } },
      orderBy: { date: 'asc' },
    });

    const seg = (dateFrom: Date, dateTo: Date) => {
      const inRange = rows.filter((r) => r.date >= dateFrom && r.date <= dateTo);
      const spend = inRange.reduce((s, r) => s + Number(r.spend), 0);
      const revenue = inRange.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
      const cost = inRange.reduce((s, r) => s + Number(r.marketingCost ?? 0), 0);
      const orders = inRange.reduce((s, r) => s + (r.orders ?? 0), 0);
      return {
        spend: Math.round(spend * 100) / 100,
        revenue: Math.round(revenue * 100) / 100,
        marketingCost: Math.round(cost * 100) / 100,
        profit: Math.round((revenue - cost) * 100) / 100,
        orders,
        roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
      };
    };

    const current = seg(from, to);
    const previous = seg(prevFrom, prevTo);

    const delta = (cur: number, prev: number) =>
      prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100) / 100;

    return {
      current,
      previous,
      deltas: {
        spend: delta(current.spend, previous.spend),
        revenue: delta(current.revenue, previous.revenue),
        profit: delta(current.profit, previous.profit),
        orders: delta(current.orders, previous.orders),
      },
      series: this.bucketSeries(rows, period),
      period,
      granularity: period,
    };
  }

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  private isoWeek(date: Date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return { year: d.getUTCFullYear(), week };
  }

  private bucketBounds(date: Date, period: string) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    switch (period) {
      case 'week': {
        const iso = this.isoWeek(date);
        const dow = date.getUTCDay() || 7;
        const start = new Date(Date.UTC(y, m, d - (dow - 1)));
        const end = new Date(Date.UTC(y, m, d - (dow - 1) + 6));
        return { label: `${iso.year}-W${String(iso.week).padStart(2, '0')}`, start, end };
      }
      case 'month': {
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        return {
          label: `${y}-${String(m + 1).padStart(2, '0')}`,
          start: new Date(Date.UTC(y, m, 1)),
          end: new Date(Date.UTC(y, m, last)),
        };
      }
      case 'quarter': {
        const q = Math.floor(m / 3) + 1;
        const startM = (q - 1) * 3;
        const endM = startM + 2;
        const last = new Date(Date.UTC(y, endM + 1, 0)).getUTCDate();
        return {
          label: `${y}-Q${q}`,
          start: new Date(Date.UTC(y, startM, 1)),
          end: new Date(Date.UTC(y, endM, last)),
        };
      }
      case 'year': {
        const last = new Date(Date.UTC(y + 1, 0, 0)).getUTCDate();
        return {
          label: `${y}`,
          start: new Date(Date.UTC(y, 0, 1)),
          end: new Date(Date.UTC(y, 11, last)),
        };
      }
      default: {
        const label = date.toISOString().slice(0, 10);
        return { label, start: date, end: date };
      }
    }
  }

  private bucketSeries(rows: any[], period: string) {
    if (period === 'day') {
      return rows.map((r) => {
        const date = r.date.toISOString().slice(0, 10);
        return {
          date,
          spend: Number(r.spend),
          revenue: Number(r.revenue ?? 0),
          marketingCost: Number(r.marketingCost ?? 0),
          profit: Number(r.profit ?? 0),
          label: date,
          start: date,
          end: date,
        };
      });
    }

    const out: any[] = [];
    let bucket: any = null;
    const flush = () => {
      if (!bucket) return;
      out.push({
        date: bucket.start,
        spend: this.round2(bucket.spend),
        revenue: this.round2(bucket.revenue),
        marketingCost: this.round2(bucket.marketingCost),
        profit: this.round2(bucket.profit),
        label: bucket.label,
        start: bucket.start,
        end: bucket.end,
      });
      bucket = null;
    };
    for (const r of rows) {
      const b = this.bucketBounds(r.date, period);
      if (!bucket || bucket.label !== b.label) {
        flush();
        bucket = {
          label: b.label,
          start: b.start.toISOString().slice(0, 10),
          end: b.end.toISOString().slice(0, 10),
          spend: 0,
          revenue: 0,
          marketingCost: 0,
          profit: 0,
        };
      }
      bucket.spend += Number(r.spend);
      bucket.revenue += Number(r.revenue ?? 0);
      bucket.marketingCost += Number(r.marketingCost ?? 0);
      bucket.profit += Number(r.profit ?? 0);
    }
    flush();
    return out;
  }

  /**
   * Profitability report for the period, straight from recorded rows.
   */
  async profitability(fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);

    const [revenueRows, marketingCostStat, platformSpend] = await Promise.all([
      this.prisma.orderAttribution.findMany({
        where: { order: { createdAt: { gte: from, lte: to } } },
        select: { order: { select: { total: true } } },
      }),
      this.prisma.marketingCostAllocation.aggregate({
        _sum: { allocatedCost: true },
        where: { calculatedAt: { gte: from, lte: to } },
      }),
      this.prisma.marketingCampaignInsight.aggregate({
        _sum: { spend: true, purchases: true, purchaseValue: true },
        where: { date: { gte: from, lte: to } },
      }),
    ]);

    const storeRevenue = revenueRows.reduce((s, r) => s + Number(r.order.total), 0);
    const cost = Number(marketingCostStat._sum.allocatedCost ?? 0);
    const spend = Number(platformSpend._sum.spend ?? 0);
    const platformOrders = Number(platformSpend._sum.purchases ?? 0);
    const orders = revenueRows.length;

    return {
      range: { from, to },
      storeRevenue: Math.round(storeRevenue * 100) / 100,
      marketingCost: Math.round(cost * 100) / 100,
      grossProfit: Math.round((storeRevenue - cost) * 100) / 100,
      grossMargin:
        storeRevenue > 0 ? Math.round(((storeRevenue - cost) / storeRevenue) * 10000) / 100 : null,
      platformSpend: Math.round(spend * 100) / 100,
      platformOrders,
      platformPurchaseValue: Math.round(Number(platformSpend._sum.purchaseValue ?? 0) * 100) / 100,
      attributedOrders: orders,
    };
  }

  /**
   * Daily summary snapshots (regenerable) — recompute for the given window
   * from insights + attributions + allocations. Deterministic: rows are
   * deleted and rebuilt, so any rate/attribution fix is reflected.
   */
  async recalculateSummaries(fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);

    const start = new Date(from);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);

    await this.prisma.marketingDailySummary.deleteMany({
      where: { date: { gte: start, lte: end } },
    });

    const campaigns = await this.prisma.marketingCampaign.findMany({
      select: { id: true, adAccountId: true },
    });
    const accountByCampaign = new Map(campaigns.map((c) => [c.id, c.adAccountId]));

    const days: Date[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(new Date(d));
    }

    const created: any[] = [];
    for (const day of days) {
      const dayEnd = new Date(day);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      const [insights, attributions, allocations] = await Promise.all([
        this.prisma.marketingCampaignInsight.groupBy({
          by: ['campaignId'],
          _sum: { spend: true, purchases: true, purchaseValue: true },
          where: { date: day },
        }),
        this.prisma.orderAttribution.findMany({
          where: {
            campaignId: { not: null },
            order: { createdAt: { gte: day, lt: dayEnd } },
          },
          select: { order: { select: { total: true } } },
        }),
        this.prisma.marketingCostAllocation.findMany({
          where: {
            calculatedAt: { gte: day, lt: dayEnd },
          },
          select: { campaignId: true, allocatedCost: true },
        }),
      ]);

      const byAccount = new Map<string, { spend: number; purchases: number; purchaseValue: number }>();
      for (const row of insights) {
        const accountId = accountByCampaign.get(row.campaignId);
        if (!accountId) continue;
        const cur = byAccount.get(accountId) ?? { spend: 0, purchases: 0, purchaseValue: 0 };
        cur.spend += Number(row._sum.spend ?? 0);
        cur.purchases += Number(row._sum.purchases ?? 0);
        cur.purchaseValue += Number(row._sum.purchaseValue ?? 0);
        byAccount.set(accountId, cur);
      }

      const costByAccount = new Map<string, number>();
      for (const a of allocations) {
        const accountId = accountByCampaign.get(a.campaignId);
        if (!accountId) continue;
        costByAccount.set(accountId, (costByAccount.get(accountId) ?? 0) + Number(a.allocatedCost));
      }

      const revenue = attributions.reduce((s, a) => s + Number(a.order.total), 0);

      for (const [accountId, stats] of byAccount) {
        const marketingCost = costByAccount.get(accountId) ?? 0;
        created.push(
          await this.prisma.marketingDailySummary.upsert({
            where: { adAccountId_date: { adAccountId: accountId, date: day } },
            update: {
              spend: stats.spend,
              purchases: stats.purchases,
              purchaseValue: stats.purchaseValue,
              orders: attributions.length,
              revenue: Math.round(revenue * 100) / 100,
              marketingCost: Math.round(marketingCost * 100) / 100,
              profit: Math.round((revenue - marketingCost) * 100) / 100,
              roas: stats.spend > 0 ? Math.round((revenue / stats.spend) * 100) / 100 : null,
              calculatedAt: new Date(),
            },
            create: {
              adAccountId: accountId,
              date: day,
              spend: stats.spend,
              purchases: stats.purchases,
              purchaseValue: stats.purchaseValue,
              orders: attributions.length,
              revenue: Math.round(revenue * 100) / 100,
              marketingCost: Math.round(marketingCost * 100) / 100,
              profit: Math.round((revenue - marketingCost) * 100) / 100,
              roas: stats.spend > 0 ? Math.round((revenue / stats.spend) * 100) / 100 : null,
            },
          }),
        );
      }
    }

    return { rebuilt: created.length, from: start, to: end };
  }

  async fundingPnL(fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        referenceNo: { startsWith: 'FUND-' },
        entryDate: { gte: from, lte: to },
      },
      include: { lines: { include: { account: true } } },
      orderBy: { entryDate: 'asc' },
    });
    return {
      entries: entries.map((e) => ({
        id: e.id,
        entryNo: e.entryNo,
        entryDate: e.entryDate,
        description: e.description,
        totalDebit: Number(e.totalDebit),
      })),
      total: entries.reduce((s, e) => s + Number(e.totalDebit), 0),
    };
  }

  async rebuildAllocations(fromDate?: string, toDate?: string) {
    return this.allocation.rebuildFromInsights(fromDate, toDate);
  }

  async intelligence(fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);

    const [attributions, allocations, purchases] = await Promise.all([
      this.prisma.orderAttribution.findMany({
        where: { order: { createdAt: { gte: from, lte: to } } },
        select: {
          method: true,
          confidence: true,
          order: {
            select: {
              createdAt: true,
              total: true,
              items: {
                select: {
                  id: true,
                  quantity: true,
                  price: true,
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.marketingCostAllocation.findMany({
        where: { calculatedAt: { gte: from, lte: to } },
        select: {
          calculatedAt: true,
          allocatedCost: true,
          productCosts: { select: { orderItemId: true, marketingCost: true } },
        },
      }),
      this.prisma.marketingDailySummary.aggregate({
        _sum: { purchases: true },
        where: { date: { gte: from, lte: to } },
      }),
    ]);

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const days: string[] = [];
    const start = new Date(from);
    start.setUTCHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(dayKey(d));
    }

    const costByDay = new Map<string, number>();
    const costByItem = new Map<string, number>();
    let marketingCost = 0;
    for (const a of allocations) {
      const cost = Number(a.allocatedCost ?? 0);
      marketingCost += cost;
      const k = dayKey(a.calculatedAt);
      costByDay.set(k, (costByDay.get(k) ?? 0) + cost);
      for (const pc of a.productCosts) {
        costByItem.set(
          pc.orderItemId,
          (costByItem.get(pc.orderItemId) ?? 0) + Number(pc.marketingCost ?? 0),
        );
      }
    }

    const revenueByDay = new Map<string, number>();
    const products = new Map<
      string,
      { id: string; name: string; revenue: number; cost: number; dayProfit: Map<string, number> }
    >();
    const byMethod = new Map<string, number>();
    let confidenceSum = 0;
    let orderRevenue = 0;

    for (const a of attributions) {
      byMethod.set(a.method, (byMethod.get(a.method) ?? 0) + 1);
      confidenceSum += a.confidence ?? 0;
      const orderDay = dayKey(a.order.createdAt);
      const total = Number(a.order.total ?? 0);
      orderRevenue += total;
      revenueByDay.set(orderDay, (revenueByDay.get(orderDay) ?? 0) + total);
      for (const item of a.order.items) {
        if (!item.product) continue;
        let p = products.get(item.product.id);
        if (!p) {
          p = {
            id: item.product.id,
            name: item.product.name,
            revenue: 0,
            cost: 0,
            dayProfit: new Map(),
          };
          products.set(p.id, p);
        }
        const itemRevenue = Number(item.price ?? 0) * item.quantity;
        const itemCost = costByItem.get(item.id) ?? 0;
        p.revenue += itemRevenue;
        p.cost += itemCost;
        p.dayProfit.set(orderDay, (p.dayProfit.get(orderDay) ?? 0) + itemRevenue - itemCost);
      }
    }

    const orders = attributions.length;
    const purchaseCount = Number(purchases._sum.purchases ?? 0);
    const trendDays = days.slice(-7);

    const costTrend = days.map((date) => ({
      date,
      cost: this.round2(costByDay.get(date) ?? 0),
    }));
    const roasTrend = days.map((date) => {
      const cost = costByDay.get(date) ?? 0;
      const revenue = revenueByDay.get(date) ?? 0;
      return {
        date,
        cost: this.round2(cost),
        revenue: this.round2(revenue),
        roas: cost > 0 ? this.round2(revenue / cost) : null,
      };
    });
    const roiTimeline = days.map((date) => {
      const cost = costByDay.get(date) ?? 0;
      const revenue = revenueByDay.get(date) ?? 0;
      return {
        date,
        cost: this.round2(cost),
        revenue: this.round2(revenue),
        roi: cost > 0 ? this.round2((revenue - cost) / cost) : null,
      };
    });

    const productProfitTrend = [...products.values()]
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        profit: this.round2(p.revenue - p.cost),
        cost: this.round2(p.cost),
        revenue: this.round2(p.revenue),
        roas: p.cost > 0 ? this.round2(p.revenue / p.cost) : null,
        trend: trendDays.map((d) => this.round2(p.dayProfit.get(d) ?? 0)),
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);

    const cac = orders > 0 ? this.round2(marketingCost / orders) : null;
    const cpp = purchaseCount > 0 ? this.round2(marketingCost / purchaseCount) : null;

    // Break-even CPA = highest CPA at which revenue covers cost (gross margin based)
    const avgOrderValue = orders > 0 ? this.round2(orderRevenue / orders) : null;
    const grossMargin = orderRevenue > 0 ? this.round2((orderRevenue - marketingCost) / orderRevenue) : null;
    const breakEvenCpa = avgOrderValue !== null && grossMargin !== null && grossMargin > 0
      ? this.round2(avgOrderValue * grossMargin)
      : null;

    const attributionConfidence = {
      avg: orders > 0 ? Math.round(confidenceSum / orders) : 0,
      byMethod: Object.fromEntries([...byMethod.entries()].sort()),
    };

    const profit = this.round2(orderRevenue - marketingCost);
    const roas = marketingCost > 0 ? this.round2(orderRevenue / marketingCost) : null;
    const money2 = (n: number) => `৳${n.toFixed(2)}`;

    return {
      range: { from, to },
      costTrend,
      roasTrend,
      productProfitTrend,
      cac,
      cpp,
      breakEvenCpa,
      grossMargin,
      roiTimeline,
      attributionConfidence,
      explainProfit: {
        revenue: this.round2(orderRevenue),
        orders,
        confidence: attributionConfidence.avg,
        cost: this.round2(marketingCost),
        profit,
        roas,
        text: `${money2(this.round2(orderRevenue))} revenue from ${orders} attributed orders at ${attributionConfidence.avg}% confidence; cost ${money2(this.round2(marketingCost))} → profit ${money2(profit)} (ROAS ${roas === null ? 'N/A' : `${roas.toFixed(2)}x`})`,
      },
    };
  }
}