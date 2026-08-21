import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AllocationMode = 'product_value' | 'equal' | 'quantity';

const ALLOCATION_MODE_SETTING = 'marketing_allocation_mode';
const ALLOCATION_MODES: AllocationMode[] = ['product_value', 'equal', 'quantity'];

interface SpendEntry {
  campaignId: string;
  date: Date;
  spend: number;
}

@Injectable()
export class MarketingAllocationService {
  private readonly logger = new Logger(MarketingAllocationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Distribute recorded campaign spend to the store orders attributed to that
   * campaign on the same day. The split method is read from the
   * `marketing_allocation_mode` system setting (product_value: marketing cost
   * proportional to share of the day's attributed revenue; equal: uniform
   * split; quantity: proportional to ordered item quantities). Rows are fully
   * replaced per (order, campaign) — rerunning is deterministic and never
   * double-counts.
   */
  private async resolveAllocationMode(): Promise<AllocationMode> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: ALLOCATION_MODE_SETTING },
      });
      const value = setting?.value as AllocationMode | undefined;
      return value && ALLOCATION_MODES.includes(value) ? value : 'product_value';
    } catch {
      return 'product_value';
    }
  }

  async allocateCampaignDate(entry: SpendEntry) {
    if (entry.spend <= 0) return { allocated: 0, orders: 0 };

    const dayStart = new Date(entry.date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const attributions = await this.prisma.orderAttribution.findMany({
      where: {
        campaignId: entry.campaignId,
        order: {
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    });

    if (attributions.length === 0) return { allocated: 0, orders: 0 };

    const candidates = attributions.filter(
      (a) => a.order && !a.order.trashedAt,
    );
    if (candidates.length === 0) return { allocated: 0, orders: 0 };

    const campaign = await this.prisma.marketingCampaign.findUnique({
      where: { id: entry.campaignId },
      select: { adAccount: { select: { currency: true } } },
    });
    const allocatedCurrency = campaign?.adAccount?.currency ?? 'USD';

    const mode = await this.resolveAllocationMode();

    const orderTotals = new Map<string, number>();
    let sumTotals = 0;
    const orderQuantities = new Map<string, number>();
    let sumQuantities = 0;
    for (const a of candidates) {
      const total = Number(a.order.total) || 0;
      orderTotals.set(a.orderId, total);
      sumTotals += total;
      const qty = a.order.items.reduce((sum, it) => sum + it.quantity, 0);
      orderQuantities.set(a.orderId, qty);
      sumQuantities += qty;
    }

    const allocated = await this.prisma.$transaction(async (tx) => {
      const dayConsumptions = await tx.marketingConsumption.findMany({
        where: {
          campaignId: entry.campaignId,
          source: 'spend_sync',
          spendDate: { gte: dayStart, lt: dayEnd },
        },
        select: { effectiveRate: true, consumedAmount: true },
      });
      const totalFundedSpend = dayConsumptions.reduce(
        (sum, r) => sum + Number(r.consumedAmount),
        0,
      );
      const dayRate =
        totalFundedSpend > 0
          ? dayConsumptions.reduce(
              (sum, r) =>
                sum +
                Number(r.consumedAmount) * Number(r.effectiveRate),
              0,
            ) / totalFundedSpend
          : 0;
      const sourceSpend = totalFundedSpend || entry.spend;

      let allocatedTotal = 0;
      for (const a of candidates) {
        let share: number;
        if (mode === 'equal') {
          share = 1 / candidates.length;
        } else if (mode === 'quantity') {
          share =
            sumQuantities > 0
              ? (orderQuantities.get(a.orderId) || 0) / sumQuantities
              : 1 / candidates.length;
        } else {
          share =
            sumTotals > 0
              ? (orderTotals.get(a.orderId) || 0) / sumTotals
              : 1 / candidates.length;
        }
        const allocatedSpend = Math.round(sourceSpend * share * 10000) / 10000;
        if (allocatedSpend <= 0) continue;
        allocatedTotal += allocatedSpend;

        const allocatedCost = Math.round(allocatedSpend * dayRate * 100) / 100;

        const allocation = await tx.marketingCostAllocation.upsert({
          where: { orderId_campaignId: { orderId: a.orderId, campaignId: entry.campaignId } },
          update: {
            allocatedSpend,
            allocatedCost,
            allocatedRate: dayRate,
            allocationMethod: mode,
            calculatedAt: new Date(),
          },
          create: {
            orderId: a.orderId,
            attributionId: a.id,
            campaignId: entry.campaignId,
            allocatedSpend,
            allocatedCurrency,
            allocatedRate: dayRate,
            allocatedCost,
            allocationMethod: mode,
          },
        });

        const items = a.order.items;
        let itemSum = 0;
        const itemValues = items.map((it) => {
          const v = Number(it.price) * it.quantity;
          itemSum += v;
          return { item: it, value: v };
        });

        await tx.productMarketingCost.deleteMany({
          where: { allocationId: allocation.id },
        });
        for (const { item, value } of itemValues) {
          const ratio = itemSum > 0 ? value / itemSum : 1 / Math.max(items.length, 1);
          await tx.productMarketingCost.create({
            data: {
              orderItemId: item.id,
              allocationId: allocation.id,
              marketingCost: Math.round(allocatedCost * ratio * 100) / 100,
              allocationRatio: ratio,
            },
          });
        }
      }
      return allocatedTotal;
    });

    return { allocated, orders: candidates.length };
  }

  /**
   * Re-run allocations for every (campaign, day) that has spend records in the
   * range. Consumptions drive the effective rate; allocations are replaced per
   * pair, so this is safe to rerun after attribution changes.
   */
  async runCampaignSpendAllocations(
    fromDate?: Date,
    toDate?: Date,
  ) {
    const where: any = {
      campaignId: { not: null },
      source: 'spend_sync',
    };
    if (fromDate || toDate) {
      where.spendDate = {};
      if (fromDate) where.spendDate.gte = fromDate;
      if (toDate) where.spendDate.lt = toDate;
    }

    const spendDays = await this.prisma.marketingConsumption.groupBy({
      by: ['campaignId', 'spendDate'],
      where,
    });

    const entries: SpendEntry[] = [];
    for (const row of spendDays) {
      if (!row.campaignId || !row.spendDate) continue;
      const dayStart = new Date(row.spendDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      const daySpend = await this.prisma.marketingConsumption.aggregate({
        _sum: { consumedAmount: true },
        where: {
          campaignId: row.campaignId,
          spendDate: { gte: dayStart, lt: dayEnd },
          source: 'spend_sync',
        },
      });

      entries.push({
        campaignId: row.campaignId,
        date: dayStart,
        spend: Number(daySpend._sum.consumedAmount ?? 0),
      });
    }

    const results: Array<{ allocated: number; orders: number }> = [];
    for (const entry of entries) {
      results.push(await this.allocateCampaignDate(entry));
    }

    return results;
  }

  /**
   * Rebuild allocations from raw insights directly (used by the recalculate
   * endpoint) — same math as spend_sync consumption path but driven by
   * insight rows, safe for dates where funding was added later.
   */
  async rebuildFromInsights(fromDate?: string, toDate?: string) {
    const where: any = {};
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(`${fromDate}T00:00:00Z`);
      if (toDate) where.date.lt = new Date(`${toDate}T23:59:59Z`);
    }

    const insights = await this.prisma.marketingCampaignInsight.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    const results: Array<{ allocated: number; orders: number }> = [];
    for (const insight of insights) {
      if (Number(insight.spend) <= 0) continue;
      results.push(
        await this.allocateCampaignDate({
          campaignId: insight.campaignId,
          date: new Date(insight.date),
          spend: Number(insight.spend),
        }),
      );
    }
    return results;
  }
}