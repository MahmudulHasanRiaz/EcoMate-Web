import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MarketingSyncService } from './marketing-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingConnectionsService } from './marketing-connections.service';
import { MetaGraphService, MetaApiError } from './meta-graph.service';
import { MarketingConsumptionService } from './marketing-consumption.service';
import { MarketingAllocationService } from './marketing-allocation.service';

describe('MarketingSyncService', () => {
  let service: MarketingSyncService;
  let prisma: PrismaService;
  let connections: MarketingConnectionsService;
  let metaGraph: MetaGraphService;
  let consumption: MarketingConsumptionService;
  let allocation: MarketingAllocationService;

  const mockAdAccount = {
    id: 'acct-1',
    providerAccountId: 'act_12345',
    isActive: true,
    lastSyncAt: null,
    connection: {
      id: 'conn-1',
      status: 'connected',
      platform: { slug: 'facebook' },
    },
  };

  const mockPrisma = () => ({
    adAccount: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    marketingCampaign: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    marketingAdSet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    marketingAd: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    marketingCampaignInsight: { upsert: jest.fn() },
    marketingSyncStatus: { upsert: jest.fn() },
    marketingAuditLog: { create: jest.fn() },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingSyncService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: MarketingConnectionsService, useValue: { getDecryptedToken: jest.fn() } },
        { provide: MetaGraphService, useValue: {
            listCampaigns: jest.fn(),
            listAdSets: jest.fn(),
            listAds: jest.fn(),
            fetchInsights: jest.fn(),
          } },
        { provide: MarketingConsumptionService, useValue: { consumeInsightSpend: jest.fn() } },
        { provide: MarketingAllocationService, useValue: { runCampaignSpendAllocations: jest.fn() } },
      ],
    }).compile();
    service = module.get(MarketingSyncService);
    prisma = module.get(PrismaService);
    connections = module.get(MarketingConnectionsService);
    metaGraph = module.get(MetaGraphService);
    consumption = module.get(MarketingConsumptionService);
    allocation = module.get(MarketingAllocationService);
  });

  afterEach(() => jest.clearAllMocks());

  const setupHappyPath = () => {
    (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(mockAdAccount);
    (connections.getDecryptedToken as jest.Mock).mockReturnValue({ token: 'EAAG-xyz' });
    (metaGraph.listCampaigns as jest.Mock).mockResolvedValue([
      { id: 'c-1', name: 'Launch', status: 'ACTIVE', objective: 'OUTCOME_SALES' },
    ]);
    (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.marketingCampaign.create as jest.Mock).mockResolvedValue({ id: 'camp-local-1', adAccountId: 'acct-1' });
    (prisma.marketingCampaign.findMany as jest.Mock).mockResolvedValue([
      { id: 'camp-old', providerCampaignId: 'c-999-deleted', deletedFromProvider: false },
    ]);
    (metaGraph.listAdSets as jest.Mock).mockResolvedValue([]);
    (metaGraph.listAds as jest.Mock).mockResolvedValue([]);
    (metaGraph.fetchInsights as jest.Mock).mockResolvedValue([
      { campaignId: 'c-1', date: '2026-08-01', impressions: 1000, reach: 800, clicks: 50, cpc: 0.4, cpm: 4, ctr: 5, spend: 20, purchases: 2, purchaseValue: 400, roas: 20, frequency: 1.2 },
    ]);
    (prisma.marketingCampaignInsight.upsert as jest.Mock).mockResolvedValue({});
    (consumption.consumeInsightSpend as jest.Mock).mockResolvedValue(undefined);
    (allocation.runCampaignSpendAllocations as jest.Mock).mockResolvedValue([]);
    (prisma.marketingSyncStatus.upsert as jest.Mock).mockResolvedValue({});
    (prisma.adAccount.update as jest.Mock).mockResolvedValue({});
    (prisma.marketingAuditLog.create as jest.Mock).mockResolvedValue({});
  };

  it('syncs campaigns → adsets → ads → insights and upserts insight rows idempotently', async () => {
    setupHappyPath();
    const res = await service.syncAdAccount('acct-1');
    expect(res).toMatchObject({ adAccountId: 'acct-1', imported: 1, totalSpend: 20, skipped: false });

    const insightArgs = (prisma.marketingCampaignInsight.upsert as jest.Mock).mock.calls[0][0];
    expect(insightArgs.where).toEqual({ campaignId_date: { campaignId: 'camp-local-1', date: new Date('2026-08-01T00:00:00Z') } });
    expect(insightArgs.create.spend).toBe(20);
    expect(insightArgs.create.purchases).toBe(2);

    expect(consumption.consumeInsightSpend).toHaveBeenCalledWith([
      { campaignId: 'camp-local-1', spend: 20, date: new Date('2026-08-01T00:00:00Z') },
    ]);
    expect(allocation.runCampaignSpendAllocations).toHaveBeenCalled();
  });

  it('marks campaigns missing from the provider as deletedFromProvider (archive, never delete)', async () => {
    setupHappyPath();
    await service.syncAdAccount('acct-1');
    expect(prisma.marketingCampaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-old' },
      data: expect.objectContaining({ deletedFromProvider: true, isArchived: true }),
    });
  });

  it('skips manual_ campaigns when detecting provider deletions', async () => {
    setupHappyPath();
    (prisma.marketingCampaign.findMany as jest.Mock).mockResolvedValue([
      { id: 'camp-manual', providerCampaignId: 'manual_abc', deletedFromProvider: false },
      { id: 'camp-provider', providerCampaignId: 'c-999', deletedFromProvider: false },
    ]);
    await service.syncAdAccount('acct-1');
    const updates = (prisma.marketingCampaign.update as jest.Mock).mock.calls.map((c: any) => c[0]);
    expect(updates.filter((u: any) => u.where.id === 'camp-manual')).toHaveLength(0);
    expect(updates.filter((u: any) => u.where.id === 'camp-provider')).toHaveLength(1);
  });

  it('refuses to sync a disconnected ad account', async () => {
    (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue({
      ...mockAdAccount,
      connection: { ...mockAdAccount.connection, status: 'disconnected' },
    });
    await expect(service.syncAdAccount('acct-1')).rejects.toThrow('Connection is not connected');
  });

  it('throws NotFound for missing ad account', async () => {
    (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.syncAdAccount('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rerun while in progress is skipped without touching data', async () => {
    setupHappyPath();
    // Simulate an in-flight run by calling _doSync twice concurrently.
    const p1 = service.syncAdAccount('acct-1');
    const p2 = service.syncAdAccount('acct-1');
    const [r1, r2] = await Promise.all([p1, p2]);
    const skipped = [r1, r2].find((r) => r.skipped === true);
    expect(skipped).toBeDefined();
    expect(skipped.reason).toBe('already running');
  });

  it('records error status and rethrows on MetaApiError, still marking sync status', async () => {
    setupHappyPath();
    (metaGraph.listCampaigns as jest.Mock).mockRejectedValue(
      new MetaApiError('Session has expired', 190, undefined),
    );
    await expect(service.syncAdAccount('acct-1')).rejects.toBeInstanceOf(MetaApiError);
    const statusCalls = (prisma.marketingSyncStatus.upsert as jest.Mock).mock.calls.map((c: any) => c[0]);
    const errorMark = statusCalls.find((c: any) => c.update?.status === 'error' || c.create?.status === 'error');
    expect(errorMark).toBeDefined();
    expect((errorMark.update?.lastError ?? errorMark.create?.lastError)).toContain('Session has expired');
    expect(prisma.adAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: expect.objectContaining({ lastError: expect.stringContaining('Session has expired') }),
    });
  });

  it('syncAll iterates every active ad account', async () => {
    (prisma.adAccount.findMany as jest.Mock).mockResolvedValue([mockAdAccount, { ...mockAdAccount, id: 'acct-2' }]);
    const spy = jest.spyOn(service as any, 'syncAdAccount').mockResolvedValue({ adAccountId: 'x', skipped: false });
    const res = await service.syncAll();
    expect(res).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith('acct-1', false);
    expect(spy).toHaveBeenCalledWith('acct-2', false);
  });
});