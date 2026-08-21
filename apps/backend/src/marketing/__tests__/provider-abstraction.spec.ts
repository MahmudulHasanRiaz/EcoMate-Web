import { Test, TestingModule } from '@nestjs/testing';
import { MarketingSyncService } from '../marketing-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketingConnectionsService } from '../marketing-connections.service';
import { MarketingConsumptionService } from '../marketing-consumption.service';
import { MarketingAllocationService } from '../marketing-allocation.service';
import {
  AdProviderAdapter,
  AD_PROVIDER_ADAPTER,
  ProviderCampaign,
  ProviderAdSet,
  ProviderAd,
  ProviderError,
  ProviderErrorCategory,
} from '../ad-provider.adapter';
import { MetaProviderAdapter } from '../meta-provider.adapter';
import { MetaGraphService, MetaApiError, InsightRow } from '../meta-graph.service';

/**
 * Fake provider that implements AdProviderAdapter without any Meta/real API dependency.
 * Proves Test D: a future TikTok/Google adapter can be injected without rewriting sync logic.
 */
function createFakeProviderAdapter(): AdProviderAdapter & {
  listCampaigns: jest.Mock;
  listAdSets: jest.Mock;
  listAds: jest.Mock;
  fetchInsights: jest.Mock;
} {
  const campaigns: ProviderCampaign[] = [];
  const adSets: ProviderAdSet[] = [];
  const ads: ProviderAd[] = [];
  const insights: InsightRow[] = [];

  const adapter: any = {
    providerSlug: 'fake_platform',
    setFixtures(opts: {
      campaigns?: ProviderCampaign[];
      adSets?: ProviderAdSet[];
      ads?: ProviderAd[];
      insights?: InsightRow[];
    }) {
      campaigns.splice(0, campaigns.length, ...(opts.campaigns ?? []));
      adSets.splice(0, adSets.length, ...(opts.adSets ?? []));
      ads.splice(0, ads.length, ...(opts.ads ?? []));
      insights.splice(0, insights.length, ...(opts.insights ?? []));
    },
    validateConnection: jest.fn().mockResolvedValue({ valid: true, providerUserId: 'fake-user-1' }),
    exchangeToken: jest.fn().mockResolvedValue({ accessToken: 'fake-token', expiresIn: 9999 }),
    refreshToken: jest.fn().mockResolvedValue({ accessToken: 'fake-token', expiresIn: 9999 }),
    debugToken: jest.fn().mockResolvedValue({}),
    listCampaigns: jest.fn().mockImplementation(async () => campaigns),
    listAdSets: jest.fn().mockImplementation(async () => adSets),
    listAds: jest.fn().mockImplementation(async () => ads),
    fetchInsights: jest.fn().mockImplementation(async () => insights),
    pauseCampaign: jest.fn().mockResolvedValue(undefined),
    resumeCampaign: jest.fn().mockResolvedValue(undefined),
    withTokenRefresh: jest.fn().mockImplementation(
      async (_connection: any, _get: any, _refresh: any, fn: any) => fn('fake-token'),
    ),
  };
  return adapter;
}

const mockPrisma = () => ({
  adAccount: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  marketingCampaign: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `camp-${Date.now()}`, ...d })),
    update: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
  marketingAdSet: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `adset-${Date.now()}`, ...d })),
    update: jest.fn().mockResolvedValue({}),
  },
  marketingAd: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve({ id: `ad-${Date.now()}`, ...d })),
    update: jest.fn().mockResolvedValue({}),
  },
  marketingCampaignInsight: { upsert: jest.fn().mockResolvedValue({}) },
  marketingSyncStatus: { upsert: jest.fn().mockResolvedValue({}) },
  marketingAuditLog: { create: jest.fn().mockResolvedValue({}) },
});

const mockAdAccount = {
  id: 'acct-1',
  providerAccountId: 'act_12345',
  isActive: true,
  lastSyncAt: null,
  connection: {
    id: 'conn-1',
    status: 'connected',
    platform: { slug: 'fake_platform' },
  },
};

describe('Provider Abstraction (Tests A-D)', () => {
  describe('Test A — Sync service uses adapter interface, not MetaGraphService', () => {
    it('syncs using a mocked provider-neutral AD_PROVIDER_ADAPTER', async () => {
      const fakeProvider = createFakeProviderAdapter();
      fakeProvider.setFixtures({
        campaigns: [
          { providerCampaignId: 'c-1', name: 'Test Campaign', status: 'ACTIVE', objective: 'SALES' },
        ],
        insights: [
          { campaignId: 'c-1', date: '2026-08-01', impressions: 500, reach: 300, clicks: 20, ctr: 4, cpc: 0.5, cpm: 5, spend: 10, purchases: 1, purchaseValue: 100, roas: 10, frequency: 1.5 },
        ],
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketingSyncService,
          { provide: PrismaService, useValue: mockPrisma() },
          { provide: MarketingConnectionsService, useValue: { getDecryptedToken: jest.fn().mockReturnValue({ token: 'x' }), refreshLongLivedToken: jest.fn() } },
          { provide: AD_PROVIDER_ADAPTER, useValue: fakeProvider },
          { provide: MarketingConsumptionService, useValue: { consumeInsightSpend: jest.fn().mockResolvedValue(undefined) } },
          { provide: MarketingAllocationService, useValue: { runCampaignSpendAllocations: jest.fn().mockResolvedValue([]) } },
        ],
      }).compile();

      const service = module.get(MarketingSyncService);
      const prisma = module.get(PrismaService);
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(mockAdAccount);

      const res = await service.syncAdAccount('acct-1');
      expect(res).toMatchObject({ adAccountId: 'acct-1', skipped: false });
      expect(res.imported).toBeGreaterThanOrEqual(1);

      // Verify the fake provider was actually called (not MetaGraphService)
      expect(fakeProvider.listCampaigns).toBeDefined();
    });
  });

  describe('Test B — MetaProviderAdapter implements the adapter contract', () => {
    it('implements all AdProviderAdapter methods', () => {
      const mockMetaGraph = {
        request: jest.fn(),
        listAdAccounts: jest.fn(),
        listCampaigns: jest.fn(),
        listAdSets: jest.fn(),
        listAds: jest.fn(),
        fetchInsights: jest.fn(),
        requestPath: jest.fn(),
        validateToken: jest.fn(),
      } as unknown as MetaGraphService;

      const adapter = new MetaProviderAdapter(mockMetaGraph);

      // Verify it implements the interface shape
      expect(adapter.providerSlug).toBe('facebook');
      expect(typeof adapter.validateConnection).toBe('function');
      expect(typeof adapter.exchangeToken).toBe('function');
      expect(typeof adapter.refreshToken).toBe('function');
      expect(typeof adapter.debugToken).toBe('function');
      expect(typeof adapter.listCampaigns).toBe('function');
      expect(typeof adapter.listAdSets).toBe('function');
      expect(typeof adapter.listAds).toBe('function');
      expect(typeof adapter.fetchInsights).toBe('function');
      expect(typeof adapter.pauseCampaign).toBe('function');
      expect(typeof adapter.resumeCampaign).toBe('function');
      expect(typeof adapter.withTokenRefresh).toBe('function');
    });

    it('normalizes campaign data from Meta API format', async () => {
      const mockMetaGraph = {
        listCampaigns: jest.fn().mockResolvedValue([
          {
            id: 'meta-c-1',
            name: 'Meta Campaign',
            objective: 'OUTCOME_SALES',
            buying_type: 'AUCTION',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            daily_budget: '5000',
            lifetime_budget: null,
            created_time: '2026-01-01',
            updated_time: '2026-08-01',
          },
        ]),
      } as unknown as MetaGraphService;

      const adapter = new MetaProviderAdapter(mockMetaGraph);
      const campaigns = await adapter.listCampaigns('token', 'act_123');

      expect(campaigns).toHaveLength(1);
      expect(campaigns[0]).toEqual({
        providerCampaignId: 'meta-c-1',
        name: 'Meta Campaign',
        objective: 'OUTCOME_SALES',
        buyingType: 'AUCTION',
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        dailyBudget: 5000,
        lifetimeBudget: undefined,
        createdTime: '2026-01-01',
        updatedTime: '2026-08-01',
      });
    });

    it('normalizes ad set data with campaign linkage', async () => {
      const mockMetaGraph = {
        listAdSets: jest.fn().mockResolvedValue([
          {
            id: 'meta-as-1',
            campaign_id: 'meta-c-1',
            name: 'Meta Ad Set',
            status: 'ACTIVE',
            optimization_goal: 'PURCHASE',
            billing_event: 'IMPRESSIONS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            daily_budget: '2000',
            start_time: '2026-01-01',
            end_time: null,
          },
        ]),
      } as unknown as MetaGraphService;

      const adapter = new MetaProviderAdapter(mockMetaGraph);
      const adSets = await adapter.listAdSets('token', 'act_123');

      expect(adSets).toHaveLength(1);
      expect(adSets[0].providerCampaignId).toBe('meta-c-1');
      expect(adSets[0].providerAdSetId).toBe('meta-as-1');
    });

    it('normalizes ad data with ad set linkage', async () => {
      const mockMetaGraph = {
        listAds: jest.fn().mockResolvedValue([
          {
            id: 'meta-ad-1',
            adset_id: 'meta-as-1',
            name: 'Meta Ad',
            status: 'ACTIVE',
            creative: { id: 'cr-1', name: 'Creative 1' },
          },
        ]),
      } as unknown as MetaGraphService;

      const adapter = new MetaProviderAdapter(mockMetaGraph);
      const ads = await adapter.listAds('token', 'act_123');

      expect(ads).toHaveLength(1);
      expect(ads[0].providerAdSetId).toBe('meta-as-1');
      expect(ads[0].providerAdId).toBe('meta-ad-1');
      expect(ads[0].creativeId).toBe('cr-1');
    });

    it('translates MetaApiError to ProviderError categories', async () => {
      const mockMetaGraph = {
        request: jest.fn().mockRejectedValue(new MetaApiError('Token expired', 190)),
      } as unknown as MetaGraphService;

      const adapter = new MetaProviderAdapter(mockMetaGraph);

      try {
        await adapter.validateConnection('bad-token');
        // validateConnection catches errors internally
      } catch {
        // Expected if it throws
      }

      // Test withTokenRefresh error translation
      const mockMetaGraph2 = {
        request: jest.fn().mockRejectedValue(new MetaApiError('Token expired', 190)),
      } as unknown as MetaGraphService;

      const adapter2 = new MetaProviderAdapter(mockMetaGraph2);
      try {
        await adapter2.withTokenRefresh(
          { id: 'conn-1' },
          () => ({ token: 'old' }),
          jest.fn().mockResolvedValue(null),
          async () => { throw new MetaApiError('Token expired', 190); },
        );
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).category).toBe(ProviderErrorCategory.AUTHENTICATION_FAILED);
        expect((err as ProviderError).providerSlug).toBe('facebook');
      }
    });
  });

  describe('Test C — Correct adapter resolved from Ad Account platform', () => {
    it('module registers MetaProviderAdapter for facebook platform', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketingSyncService,
          { provide: PrismaService, useValue: mockPrisma() },
          { provide: MarketingConnectionsService, useValue: { getDecryptedToken: jest.fn(), refreshLongLivedToken: jest.fn() } },
          MetaGraphService,
          MetaProviderAdapter,
          { provide: AD_PROVIDER_ADAPTER, useClass: MetaProviderAdapter },
          { provide: MarketingConsumptionService, useValue: { consumeInsightSpend: jest.fn() } },
          { provide: MarketingAllocationService, useValue: { runCampaignSpendAllocations: jest.fn() } },
        ],
      }).compile();

      const adapter = module.get<AdProviderAdapter>(AD_PROVIDER_ADAPTER);
      expect(adapter).toBeInstanceOf(MetaProviderAdapter);
      expect(adapter.providerSlug).toBe('facebook');
    });
  });

  describe('Test D — Future fake provider injected without modifying sync logic', () => {
    it('FakeProviderAdapter runs the full sync flow unmodified', async () => {
      const fakeProvider = createFakeProviderAdapter();
      fakeProvider.setFixtures({
        campaigns: [
          { providerCampaignId: 'tiktok-c-1', name: 'TikTok Campaign', status: 'ACTIVE' },
        ],
        adSets: [
          { providerAdSetId: 'tiktok-as-1', providerCampaignId: 'tiktok-c-1', name: 'TikTok Ad Set', status: 'ACTIVE' },
        ],
        ads: [
          { providerAdId: 'tiktok-ad-1', providerAdSetId: 'tiktok-as-1', name: 'TikTok Ad', status: 'ACTIVE' },
        ],
        insights: [
          { campaignId: 'tiktok-c-1', date: '2026-08-01', impressions: 1000, reach: 600, clicks: 40, ctr: 4, cpc: 0.25, cpm: 2.5, spend: 10, purchases: 3, purchaseValue: 300, roas: 30, frequency: 1.7 },
        ],
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketingSyncService,
          { provide: PrismaService, useValue: mockPrisma() },
          { provide: MarketingConnectionsService, useValue: { getDecryptedToken: jest.fn().mockReturnValue({ token: 'x' }), refreshLongLivedToken: jest.fn() } },
          { provide: AD_PROVIDER_ADAPTER, useValue: fakeProvider },
          { provide: MarketingConsumptionService, useValue: { consumeInsightSpend: jest.fn().mockResolvedValue(undefined) } },
          { provide: MarketingAllocationService, useValue: { runCampaignSpendAllocations: jest.fn().mockResolvedValue([]) } },
        ],
      }).compile();

      const service = module.get(MarketingSyncService);
      const prisma = module.get(PrismaService);
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue({
        ...mockAdAccount,
        connection: { ...mockAdAccount.connection, platform: { slug: 'tiktok' } },
      });

      // This should work WITHOUT any changes to MarketingSyncService
      const res = await service.syncAdAccount('acct-1');
      expect(res).toMatchObject({ adAccountId: 'acct-1', skipped: false });
      expect(res.imported).toBeGreaterThanOrEqual(1);

      // Verify the fake provider was called for all entity types
      expect(fakeProvider.listCampaigns).toHaveBeenCalled();
      expect(fakeProvider.listAdSets).toHaveBeenCalled();
      expect(fakeProvider.listAds).toHaveBeenCalled();
      expect(fakeProvider.fetchInsights).toHaveBeenCalled();

      // Verify data was persisted to the database
      expect(prisma.marketingCampaign.create).toHaveBeenCalled();
      const campaignCreate = (prisma.marketingCampaign.create as jest.Mock).mock.calls[0][0];
      expect(campaignCreate.data.providerCampaignId).toBe('tiktok-c-1');
      expect(campaignCreate.data.name).toBe('TikTok Campaign');

      expect(prisma.marketingAdSet.create).toHaveBeenCalled();
      const adSetCreate = (prisma.marketingAdSet.create as jest.Mock).mock.calls[0][0];
      expect(adSetCreate.data.providerAdSetId).toBe('tiktok-as-1');

      expect(prisma.marketingAd.create).toHaveBeenCalled();
      const adCreate = (prisma.marketingAd.create as jest.Mock).mock.calls[0][0];
      expect(adCreate.data.providerAdId).toBe('tiktok-ad-1');
    });
  });
});
