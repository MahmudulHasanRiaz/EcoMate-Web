import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingConnectionsService } from './marketing-connections.service';
import { MetaGraphService, MetaApiError } from './meta-graph.service';
import { MarketingConsumptionService } from './marketing-consumption.service';
import { MarketingAllocationService } from './marketing-allocation.service';
import { DEFAULT_INSIGHT_LOOKBACK_DAYS } from './marketing.constants';

@Injectable()
export class MarketingSyncService {
  private readonly logger = new Logger(MarketingSyncService.name);
  private readonly running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private connections: MarketingConnectionsService,
    private metaGraph: MetaGraphService,
    private consumption: MarketingConsumptionService,
    private allocation: MarketingAllocationService,
  ) {}

  async syncAll(forceInsights = false) {
    const accounts = await this.prisma.adAccount.findMany({
      where: { isActive: true },
    });
    const results: Array<{
      adAccountId: string;
      imported?: number;
      updated?: number;
      totalSpend?: number;
      skipped?: boolean;
      reason?: string;
    }> = [];
    for (const account of accounts) {
      results.push(await this.syncAdAccount(account.id, forceInsights));
    }
    return results;
  }

  async syncAdAccount(adAccountId: string, forceInsights = false) {
    if (this.running.has(adAccountId)) {
      return { adAccountId, skipped: true, reason: 'already running' };
    }
    this.running.add(adAccountId);
    try {
      return await this.doSync(adAccountId, forceInsights);
    } finally {
      this.running.delete(adAccountId);
    }
  }

  private async doSync(adAccountId: string, forceInsights: boolean) {
    const adAccount = await this.prisma.adAccount.findUnique({
      where: { id: adAccountId },
      include: { connection: { include: { platform: true } } },
    });
    if (!adAccount) throw new NotFoundException('Ad account not found');
    if (adAccount.connection.status !== 'connected') {
      throw new Error('Connection is not connected');
    }

    const { token } = this.connections.getDecryptedToken(adAccount.connection);
    const mark = (stage: string, progressPct: number) =>
      this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage, progressPct, status: 'running', lastError: null, updatedAt: new Date() },
        create: {
          adAccountId,
          provider: adAccount.connection.platform.slug,
          stage,
          status: 'running',
          progressPct,
        },
      });

    try {
      await mark('campaigns', 10);
      const campaigns = await this.metaGraph.listCampaigns(
        adAccount.providerAccountId,
        token,
      );

      const campaignMap = new Map<
        string,
        { id: string; adAccountId: string }
      >();
      let imported = 0;
      let updated = 0;

      for (const c of campaigns) {
        const existing = await this.prisma.marketingCampaign.findUnique({
          where: { providerCampaignId: c.id },
        });
        if (existing) {
          updated++;
          await this.prisma.marketingCampaign.update({
            where: { id: existing.id },
            data: this.campaignData(c),
          });
          campaignMap.set(c.id, { id: existing.id, adAccountId: existing.adAccountId });
        } else {
          imported++;
          const created = await this.prisma.marketingCampaign.create({
            data: {
              adAccountId,
              providerCampaignId: c.id,
              ...this.campaignData(c),
            },
          });
          campaignMap.set(c.id, { id: created.id, adAccountId });
        }
      }

      const ownedCampaignIds =
        await this.prisma.marketingCampaign.findMany({
          where: { adAccountId, deletedFromProvider: false },
          select: { id: true, providerCampaignId: true },
        });
      const seen = new Set(campaigns.map((c) => c.id));
      for (const oc of ownedCampaignIds) {
        if (!seen.has(oc.providerCampaignId) && !oc.providerCampaignId.includes('manual_')) {
          await this.prisma.marketingCampaign.update({
            where: { id: oc.id },
            data: { deletedFromProvider: true, isArchived: true },
          });
        }
      }

      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage: 'adsets', progressPct: 30 },
        create: { adAccountId, provider: adAccount.connection.platform.slug, stage: 'adsets', status: 'running', progressPct: 30 },
      });
      const adSets = await this.metaGraph.listAdSets(
        adAccount.providerAccountId,
        token,
      );
      const adSetMap = new Map<string, string>();
      for (const s of adSets) {
        const target = campaignMap.get(s.campaign_id);
        if (!target) continue;
        const existing = await this.prisma.marketingAdSet.findUnique({
          where: { providerAdSetId: s.id },
        });
        if (existing) {
          updated++;
          await this.prisma.marketingAdSet.update({
            where: { id: existing.id },
            data: this.adSetData(s, target.id),
          });
          adSetMap.set(s.id, existing.id);
        } else {
          imported++;
          const created = await this.prisma.marketingAdSet.create({
            data: {
              campaignId: target.id,
              providerAdSetId: s.id,
              ...this.adSetData(s, target.id),
            },
          });
          adSetMap.set(s.id, created.id);
        }
      }

      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage: 'ads', progressPct: 45 },
        create: { adAccountId, provider: adAccount.connection.platform.slug, stage: 'ads', status: 'running', progressPct: 45 },
      });
      const ads = await this.metaGraph.listAds(
        adAccount.providerAccountId,
        token,
      );
      for (const ad of ads) {
        const targetSetId = adSetMap.get(ad.adset_id);
        if (!targetSetId) continue;
        const existing = await this.prisma.marketingAd.findUnique({
          where: { providerAdId: ad.id },
        });
        if (existing) {
          updated++;
          await this.prisma.marketingAd.update({
            where: { id: existing.id },
            data: this.adData(ad, targetSetId),
          });
        } else {
          imported++;
          await this.prisma.marketingAd.create({
            data: {
              adSetId: targetSetId,
              providerAdId: ad.id,
              ...this.adData(ad, targetSetId),
            },
          });
        }
      }

      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage: 'insights', progressPct: 60 },
        create: { adAccountId, provider: adAccount.connection.platform.slug, stage: 'insights', status: 'running', progressPct: 60 },
      });

      const until = new Date();
      const lastSync = adAccount.lastSyncAt;
      let since: Date;
      if (forceInsights || !lastSync) {
        since = new Date();
        since.setDate(since.getDate() - DEFAULT_INSIGHT_LOOKBACK_DAYS);
      } else {
        since = new Date(lastSync);
        since.setDate(since.getDate() - 2);
      }
      if (since > until) since = until;

      const sinceStr = since.toISOString().slice(0, 10);
      const untilStr = until.toISOString().slice(0, 10);

      let insightRows: Awaited<ReturnType<MetaGraphService['fetchInsights']>> = [];
      try {
        insightRows = await this.metaGraph.fetchInsights(
          adAccount.providerAccountId,
          token,
          sinceStr,
          untilStr,
        );
      } catch (err) {
        this.logger.warn(`Insights fetch failed for ${adAccountId}: ${err instanceof Error ? err.message : err}`);
        if (!(err instanceof MetaApiError)) throw err;
      }

      const totalSpend = await this.applyInsights(campaignMap, insightRows);

      await this.allocation.runCampaignSpendAllocations();

      await mark('done', 100);
      await this.prisma.adAccount.update({
        where: { id: adAccountId },
        data: { lastSyncAt: new Date(), lastError: null },
      });
      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { status: 'idle', lastRunAt: new Date(), lastSuccessAt: new Date(), lastError: null, recordsImported: imported, recordsUpdated: updated, progressPct: 100 },
        create: { adAccountId, provider: adAccount.connection.platform.slug, status: 'idle', lastRunAt: new Date(), lastSuccessAt: new Date(), recordsImported: imported, recordsUpdated: updated },
      });
      await this.prisma.marketingAuditLog.create({
        data: {
          action: 'sync.complete',
          entityType: 'ad_account',
          entityId: adAccountId,
          metadata: { imported, updated, spend: totalSpend },
        },
      });

      return { adAccountId, imported, updated, totalSpend, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Marketing sync failed for ${adAccountId}: ${message}`,
      );
      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: {
          status: err instanceof MetaApiError ? 'error' : 'error',
          lastError: message,
          lastRunAt: new Date(),
          updatedAt: new Date(),
        },
        create: { adAccountId, provider: 'facebook', status: 'error', lastError: message, lastRunAt: new Date() },
      });
      await this.prisma.adAccount.update({
        where: { id: adAccountId },
        data: { lastError: message },
      });
      throw err;
    }
  }

  private campaignData(c: Record<string, any>) {
    return {
      name: c.name ?? 'Unknown campaign',
      objective: c.objective ?? null,
      buyingType: c.buying_type ?? null,
      status: c.status ?? 'UNKNOWN',
      effectiveStatus: c.effective_status ?? null,
      dailyBudget: c.daily_budget ? Number(c.daily_budget) : null,
      lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) : null,
      createdTime: c.created_time ? new Date(c.created_time) : null,
      updatedTime: c.updated_time ? new Date(c.updated_time) : null,
      startTime: c.start_time ? new Date(c.start_time) : null,
      stopTime: c.stop_time ? new Date(c.stop_time) : null,
      isArchived: ['ARCHIVED', 'DELETED'].includes(c.status),
      deletedFromProvider: c.status === 'DELETED',
      lastSyncedAt: new Date(),
    };
  }

  private adSetData(s: Record<string, any>, campaignId: string) {
    return {
      name: s.name ?? 'Unknown ad set',
      status: s.status ?? 'UNKNOWN',
      optimizationGoal: s.optimization_goal ?? null,
      billingEvent: s.billing_event ?? null,
      bidStrategy: s.bid_strategy ?? null,
      budget: s.daily_budget ? Number(s.daily_budget) : null,
      startTime: s.start_time ? new Date(s.start_time) : null,
      endTime: s.end_time ? new Date(s.end_time) : null,
      isArchived: ['ARCHIVED', 'DELETED'].includes(s.status),
      deletedFromProvider: s.status === 'DELETED',
      lastSyncedAt: new Date(),
    };
  }

  private adData(a: Record<string, any>, adSetId: string) {
    return {
      name: a.name ?? 'Unknown ad',
      status: a.status ?? 'UNKNOWN',
      isArchived: ['ARCHIVED', 'DELETED'].includes(a.status),
      deletedFromProvider: a.status === 'DELETED',
      lastSyncedAt: new Date(),
      creativeId: a.creative?.id ?? null,
      creativeName: a.creative?.name ?? null,
    };
  }

  private async applyInsights(
    campaignMap: Map<string, { id: string; adAccountId: string }>,
    rows: Awaited<ReturnType<MetaGraphService['fetchInsights']>>,
  ): Promise<number> {
    let totalSpend = 0;
    const spendEntries: Array<{ campaignId: string; spend: number; date: Date }> = [];

    for (const row of rows) {
      const target = campaignMap.get(row.campaignId);
      if (!target) continue;
      totalSpend += row.spend;
      const date = new Date(`${row.date}T00:00:00Z`);
      const data = {
        impressions: row.impressions,
        reach: row.reach,
        clicks: row.clicks,
        cpc: row.cpc || null,
        cpm: row.cpm || null,
        ctr: row.ctr || null,
        spend: row.spend,
        purchases: row.purchases,
        purchaseValue: row.purchaseValue || null,
        roas: row.roas || null,
        frequency: row.frequency || null,
        syncedAt: new Date(),
      };
      await this.prisma.marketingCampaignInsight.upsert({
        where: { campaignId_date: { campaignId: target.id, date } },
        update: data,
        create: { campaignId: target.id, date, ...data },
      });
      if (row.spend > 0) {
        spendEntries.push({
          campaignId: target.id,
          spend: row.spend,
          date,
        });
      }
    }

    await this.consumption.consumeInsightSpend(spendEntries);

    return totalSpend;
  }
}