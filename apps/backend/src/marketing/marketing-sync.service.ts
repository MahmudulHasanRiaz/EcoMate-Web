import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingConnectionsService } from './marketing-connections.service';
import { MarketingConsumptionService } from './marketing-consumption.service';
import { MarketingAllocationService } from './marketing-allocation.service';
import { DEFAULT_INSIGHT_LOOKBACK_DAYS } from './marketing.constants';
import {
  type AdProviderAdapter,
  AD_PROVIDER_ADAPTER,
  ProviderError,
  ProviderErrorCategory,
  ProviderCampaign,
  ProviderAdSet,
  ProviderAd,
} from './ad-provider.adapter';
import type { InsightRow } from './meta-graph.service';

@Injectable()
export class MarketingSyncService {
  private readonly logger = new Logger(MarketingSyncService.name);
  private readonly running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private connections: MarketingConnectionsService,
    @Inject(AD_PROVIDER_ADAPTER) private provider: AdProviderAdapter,
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

    const providerSlug = adAccount.connection.platform.slug;
    const mark = (stage: string, progressPct: number) =>
      this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage, progressPct, status: 'running', lastError: null, updatedAt: new Date() },
        create: {
          adAccountId,
          provider: providerSlug,
          stage,
          status: 'running',
          progressPct,
        },
      });

    try {
      // ── Campaigns ──────────────────────────────────────────────────
      await mark('campaigns', 10);
      const campaigns = await this.provider.withTokenRefresh(
        adAccount.connection,
        (c) => this.connections.getDecryptedToken(c),
        (id) => this.connections.refreshLongLivedToken(id),
        (t) => this.provider.listCampaigns(t, adAccount.providerAccountId),
      );

      const campaignMap = new Map<
        string,
        { id: string; adAccountId: string }
      >();
      let imported = 0;
      let updated = 0;

      for (const c of campaigns) {
        const existing = await this.prisma.marketingCampaign.findUnique({
          where: { providerCampaignId: c.providerCampaignId },
        });
        if (existing) {
          updated++;
          await this.prisma.marketingCampaign.update({
            where: { id: existing.id },
            data: this.campaignData(c),
          });
          campaignMap.set(c.providerCampaignId, { id: existing.id, adAccountId: existing.adAccountId });
        } else {
          imported++;
          const created = await this.prisma.marketingCampaign.create({
            data: {
              adAccountId,
              providerCampaignId: c.providerCampaignId,
              ...this.campaignData(c),
            },
          });
          campaignMap.set(c.providerCampaignId, { id: created.id, adAccountId });
        }
      }

      // Mark campaigns deleted from provider
      const ownedCampaignIds =
        await this.prisma.marketingCampaign.findMany({
          where: { adAccountId, deletedFromProvider: false },
          select: { id: true, providerCampaignId: true },
        });
      const seen = new Set(campaigns.map((c) => c.providerCampaignId));
      for (const oc of ownedCampaignIds) {
        if (!seen.has(oc.providerCampaignId) && !oc.providerCampaignId.includes('manual_')) {
          await this.prisma.marketingCampaign.update({
            where: { id: oc.id },
            data: { deletedFromProvider: true, isArchived: true },
          });
        }
      }

      // ── Ad Sets ────────────────────────────────────────────────────
      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage: 'adsets', progressPct: 30 },
        create: { adAccountId, provider: providerSlug, stage: 'adsets', status: 'running', progressPct: 30 },
      });
      const adSets = await this.provider.withTokenRefresh(
        adAccount.connection,
        (c) => this.connections.getDecryptedToken(c),
        (id) => this.connections.refreshLongLivedToken(id),
        (t) => this.provider.listAdSets(t, adAccount.providerAccountId),
      );
      const adSetMap = new Map<string, string>();
      for (const s of adSets) {
        const target = campaignMap.get(s.providerCampaignId);
        if (!target) continue;
        const existing = await this.prisma.marketingAdSet.findUnique({
          where: { providerAdSetId: s.providerAdSetId },
        });
        if (existing) {
          updated++;
          await this.prisma.marketingAdSet.update({
            where: { id: existing.id },
            data: this.adSetData(s, target.id),
          });
          adSetMap.set(s.providerAdSetId, existing.id);
        } else {
          imported++;
          const created = await this.prisma.marketingAdSet.create({
            data: {
              campaignId: target.id,
              providerAdSetId: s.providerAdSetId,
              ...this.adSetData(s, target.id),
            },
          });
          adSetMap.set(s.providerAdSetId, created.id);
        }
      }

      // ── Ads ────────────────────────────────────────────────────────
      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage: 'ads', progressPct: 45 },
        create: { adAccountId, provider: providerSlug, stage: 'ads', status: 'running', progressPct: 45 },
      });
      const ads = await this.provider.withTokenRefresh(
        adAccount.connection,
        (c) => this.connections.getDecryptedToken(c),
        (id) => this.connections.refreshLongLivedToken(id),
        (t) => this.provider.listAds(t, adAccount.providerAccountId),
      );
      for (const ad of ads) {
        const targetSetId = adSetMap.get(ad.providerAdSetId);
        if (!targetSetId) continue;
        const existing = await this.prisma.marketingAd.findUnique({
          where: { providerAdId: ad.providerAdId },
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
              providerAdId: ad.providerAdId,
              ...this.adData(ad, targetSetId),
            },
          });
        }
      }

      // ── Insights ───────────────────────────────────────────────────
      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: { stage: 'insights', progressPct: 60 },
        create: { adAccountId, provider: providerSlug, stage: 'insights', status: 'running', progressPct: 60 },
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

      let insightRows: InsightRow[] = [];
      try {
        insightRows = await this.provider.withTokenRefresh(
          adAccount.connection,
          (c) => this.connections.getDecryptedToken(c),
          (id) => this.connections.refreshLongLivedToken(id),
          (t) => this.provider.fetchInsights(t, adAccount.providerAccountId, { since: sinceStr, until: untilStr }),
        );
      } catch (err) {
        const translated = err instanceof ProviderError ? err : undefined;
        const category = translated?.category ?? ProviderErrorCategory.UNKNOWN;
        // Rate limits and temporary failures are non-fatal for insights
        if (category === ProviderErrorCategory.RATE_LIMITED || category === ProviderErrorCategory.TEMPORARY_FAILURE) {
          this.logger.warn(`Insights fetch non-fatal for ${adAccountId}: ${translated?.message ?? err}`);
        } else if (category === ProviderErrorCategory.AUTHENTICATION_FAILED) {
          // Token expired — already retried via withTokenRefresh; if still failing, skip insights
          this.logger.warn(`Insights fetch skipped (auth) for ${adAccountId}: ${translated?.message}`);
        } else {
          throw err;
        }
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
        create: { adAccountId, provider: providerSlug, status: 'idle', lastRunAt: new Date(), lastSuccessAt: new Date(), recordsImported: imported, recordsUpdated: updated },
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
      const status = (err instanceof ProviderError && err.category === ProviderErrorCategory.AUTHENTICATION_FAILED)
        ? 'error' : 'error';
      await this.prisma.marketingSyncStatus.upsert({
        where: { adAccountId },
        update: {
          status,
          lastError: message,
          lastRunAt: new Date(),
          updatedAt: new Date(),
        },
        create: { adAccountId, provider: providerSlug, status: 'error', lastError: message, lastRunAt: new Date() },
      });
      await this.prisma.adAccount.update({
        where: { id: adAccountId },
        data: { lastError: message },
      });
      throw err;
    }
  }

  // ── Normalized data mappers ────────────────────────────────────────

  private campaignData(c: ProviderCampaign) {
    return {
      name: c.name,
      objective: c.objective ?? null,
      buyingType: c.buyingType ?? null,
      status: c.status,
      effectiveStatus: c.effectiveStatus ?? null,
      dailyBudget: c.dailyBudget ?? null,
      lifetimeBudget: c.lifetimeBudget ?? null,
      createdTime: c.createdTime ? new Date(c.createdTime) : null,
      updatedTime: c.updatedTime ? new Date(c.updatedTime) : null,
      isArchived: ['ARCHIVED', 'DELETED'].includes(c.status),
      deletedFromProvider: c.status === 'DELETED',
      lastSyncedAt: new Date(),
    };
  }

  private adSetData(s: ProviderAdSet, campaignId: string) {
    return {
      name: s.name,
      status: s.status,
      optimizationGoal: s.optimizationGoal ?? null,
      billingEvent: s.billingEvent ?? null,
      bidStrategy: s.bidStrategy ?? null,
      budget: s.budget ?? null,
      startTime: s.startTime ? new Date(s.startTime) : null,
      endTime: s.endTime ? new Date(s.endTime) : null,
      isArchived: ['ARCHIVED', 'DELETED'].includes(s.status),
      deletedFromProvider: s.status === 'DELETED',
      lastSyncedAt: new Date(),
    };
  }

  private adData(a: ProviderAd, adSetId: string) {
    return {
      name: a.name,
      status: a.status,
      isArchived: ['ARCHIVED', 'DELETED'].includes(a.status),
      deletedFromProvider: a.status === 'DELETED',
      lastSyncedAt: new Date(),
      creativeId: a.creativeId ?? null,
      creativeName: a.creativeName ?? null,
    };
  }

  private async applyInsights(
    campaignMap: Map<string, { id: string; adAccountId: string }>,
    rows: InsightRow[],
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
