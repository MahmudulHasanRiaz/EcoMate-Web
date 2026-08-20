import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { MarketingAnalysisService } from './marketing-analysis.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingAllocationService } from './marketing-allocation.service';

describe('MarketingAnalysisService', () => {
  let service: MarketingAnalysisService;
  let prisma: PrismaService;

  const mockPrisma = () => ({
    marketingCampaignInsight: { aggregate: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    orderAttribution: { findMany: jest.fn() },
    marketingCostAllocation: { aggregate: jest.fn(), findMany: jest.fn() },
    marketingCampaign: { findUnique: jest.fn(), findMany: jest.fn() },
    marketingConsumption: { aggregate: jest.fn() },
    marketingDailySummary: { deleteMany: jest.fn(), upsert: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
    journalEntry: { findMany: jest.fn() },
  });

  const mockInsightAggregate = (over: Partial<any> = {}) => ({
    _sum: { spend: 1000, impressions: 50000, clicks: 2000, purchases: 10, purchaseValue: 15000 },
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingAnalysisService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: MarketingAllocationService, useValue: { rebuildFromInsights: jest.fn() } },
      ],
    }).compile();
    service = module.get(MarketingAnalysisService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('kpis', () => {
    it('aggregates platform spend and store revenue from recorded rows only', async () => {
      (prisma.marketingCampaignInsight.aggregate as jest.Mock).mockResolvedValue(mockInsightAggregate());
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
        { order: { total: 8000 } },
        { order: { total: 2000 } },
      ]);
      (prisma.marketingCostAllocation.aggregate as jest.Mock).mockResolvedValue({ _sum: { allocatedCost: 500 } });

      const res = await service.kpis('2026-08-01', '2026-08-19');

      expect(res.platform.spend).toBe(1000);
      expect(res.platform.purchases).toBe(10);
      expect(res.platform.roas).toBe(15);
      expect(res.store.orders).toBe(2);
      expect(res.store.revenue).toBe(10000);
      expect(res.store.marketingCost).toBe(500);
      expect(res.store.grossProfit).toBe(9500);
      expect(res.store.roas).toBe(20);
      expect(res.store.aov).toBe(5000);
    });

    it('returns null ratios when base is zero (zeros, not crashes)', async () => {
      (prisma.marketingCampaignInsight.aggregate as jest.Mock).mockResolvedValue(mockInsightAggregate({ _sum: { spend: 0, purchases: 0, purchaseValue: 0 } }));
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.marketingCostAllocation.aggregate as jest.Mock).mockResolvedValue({ _sum: { allocatedCost: 0 } });
      const res = await service.kpis();
      expect(res.platform.roas).toBeNull();
      expect(res.store.roas).toBeNull();
      expect(res.store.aov).toBeNull();
    });
  });

  describe('campaignPerformance', () => {
    it('throws NotFound for unknown campaign', async () => {
      (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.campaignPerformance('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('computes store-side ROAS from consumed (BDT) cost, not raw spend', async () => {
      (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue({
        id: 'camp-1',
        name: 'Launch',
        status: 'ACTIVE',
      });
      (prisma.marketingCampaignInsight.aggregate as jest.Mock).mockResolvedValue(
        mockInsightAggregate({ _sum: { spend: 100, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0 } }),
      );
      (prisma.marketingConsumption.aggregate as jest.Mock).mockResolvedValue({
        _sum: { calculatedCost: 12500, consumedAmount: 100 },
      });
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
        { order: { total: 6000, createdAt: new Date() } },
        { order: { total: 4000, createdAt: new Date() } },
      ]);

      const res = await service.campaignPerformance('camp-1');
      expect(res.store.orders).toBe(2);
      expect(res.store.revenue).toBe(10000);
      expect(res.store.marketingCost).toBe(12500);
      expect(res.store.profit).toBe(-2500);
      expect(res.store.roas).toBeCloseTo(0.8, 1);
    });
  });

  describe('periodOverview', () => {
    it('splits series into current vs previous and computes deltas', async () => {
      const day = (d: string, spend: number, revenue: number) => ({
        date: new Date(`${d}T00:00:00Z`),
        spend,
        revenue,
        marketingCost: spend * 120,
        profit: revenue - spend * 120,
        orders: Math.round(revenue / 1000),
      });
      // 30-day window from 2026-08-01; previous window 2026-07-02..2026-07-31
      (prisma.marketingDailySummary.findMany as jest.Mock).mockResolvedValue([
        day('2026-07-05', 10, 500),
        day('2026-08-05', 20, 2000),
      ]);
      const res = await service.periodOverview('2026-08-01', '2026-08-30');
      expect(res.current.spend).toBe(20);
      expect(res.previous.spend).toBe(10);
      expect(res.current.revenue).toBe(2000);
      expect(res.deltas.spend).toBe(1); // (20-10)/10
      expect(res.series).toHaveLength(2);
    });

    it('rejects an invalid period with 400', async () => {
      await expect(service.periodOverview(undefined, undefined, 'fortnight')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('buckets series weekly with YYYY-Www labels and bucket bounds', async () => {
      const day = (d: string, spend: number) => ({
        date: new Date(`${d}T00:00:00Z`),
        spend,
        revenue: spend * 100,
        marketingCost: spend * 120,
        profit: spend * 100 - spend * 120,
        orders: 1,
      });
      (prisma.marketingDailySummary.findMany as jest.Mock).mockResolvedValue([
        day('2026-08-05', 10),
        day('2026-08-10', 20),
      ]);
      const res = await service.periodOverview('2026-08-01', '2026-08-30', 'week');
      expect(res.series).toHaveLength(2);
      expect(res.series[0]).toMatchObject({
        label: '2026-W32',
        date: '2026-08-03',
        start: '2026-08-03',
        end: '2026-08-09',
        spend: 10,
        revenue: 1000,
      });
      expect(res.series[1]).toMatchObject({
        label: '2026-W33',
        date: '2026-08-10',
        start: '2026-08-10',
        end: '2026-08-16',
        spend: 20,
      });
    });

    it('buckets series monthly into YYYY-MM', async () => {
      const day = (d: string, spend: number) => ({
        date: new Date(`${d}T00:00:00Z`),
        spend,
        revenue: spend * 100,
        marketingCost: spend * 120,
        profit: spend * 100 - spend * 120,
        orders: 1,
      });
      (prisma.marketingDailySummary.findMany as jest.Mock).mockResolvedValue([
        day('2026-08-05', 10),
        day('2026-09-03', 20),
      ]);
      const res = await service.periodOverview('2026-08-01', '2026-09-30', 'month');
      expect(res.series[0]).toMatchObject({
        label: '2026-08',
        start: '2026-08-01',
        end: '2026-08-31',
        spend: 10,
      });
      expect(res.series[1]).toMatchObject({
        label: '2026-09',
        start: '2026-09-01',
        end: '2026-09-30',
        spend: 20,
      });
    });

    it('buckets series quarterly into YYYY-Qn', async () => {
      const day = (d: string, spend: number) => ({
        date: new Date(`${d}T00:00:00Z`),
        spend,
        revenue: spend * 100,
        marketingCost: spend * 120,
        profit: spend * 100 - spend * 120,
        orders: 1,
      });
      (prisma.marketingDailySummary.findMany as jest.Mock).mockResolvedValue([
        day('2026-08-05', 10),
        day('2026-11-20', 20),
      ]);
      const res = await service.periodOverview('2026-08-01', '2026-12-31', 'quarter');
      expect(res.series[0]).toMatchObject({
        label: '2026-Q3',
        start: '2026-07-01',
        end: '2026-09-30',
        spend: 10,
      });
      expect(res.series[1]).toMatchObject({
        label: '2026-Q4',
        start: '2026-10-01',
        end: '2026-12-31',
        spend: 20,
      });
    });

    it('buckets series yearly into a single YYYY bucket', async () => {
      const day = (d: string, spend: number) => ({
        date: new Date(`${d}T00:00:00Z`),
        spend,
        revenue: spend * 100,
        marketingCost: spend * 120,
        profit: spend * 100 - spend * 120,
        orders: 1,
      });
      (prisma.marketingDailySummary.findMany as jest.Mock).mockResolvedValue([
        day('2026-08-05', 10),
        day('2026-12-01', 20),
      ]);
      const res = await service.periodOverview('2026-08-01', '2026-12-31', 'year');
      expect(res.series).toHaveLength(1);
      expect(res.series[0]).toMatchObject({
        label: '2026',
        start: '2026-01-01',
        end: '2026-12-31',
        spend: 30,
      });
    });

    it('adapts previous-window deltas to a non-day period', async () => {
      const day = (d: string, spend: number, revenue: number) => ({
        date: new Date(`${d}T00:00:00Z`),
        spend,
        revenue,
        marketingCost: spend * 120,
        profit: revenue - spend * 120,
        orders: Math.round(revenue / 1000),
      });
      (prisma.marketingDailySummary.findMany as jest.Mock).mockResolvedValue([
        day('2026-07-05', 10, 500),
        day('2026-08-05', 20, 2000),
      ]);
      const res = await service.periodOverview('2026-08-01', '2026-08-30', 'month');
      expect(res.current.spend).toBe(20);
      expect(res.previous.spend).toBe(10);
      expect(res.current.revenue).toBe(2000);
      expect(res.deltas.spend).toBe(1);
      expect(res.deltas.profit).toBeCloseTo(0.43, 2);
    });
  });

  describe('profitability', () => {
    it('reports gross margin and platform figures', async () => {
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
        { order: { total: 20000 } },
      ]);
      (prisma.marketingCostAllocation.aggregate as jest.Mock).mockResolvedValue({ _sum: { allocatedCost: 5000 } });
      (prisma.marketingCampaignInsight.aggregate as jest.Mock).mockResolvedValue(
        mockInsightAggregate({ _sum: { spend: 1000, purchases: 10, purchaseValue: 15000 } }),
      );
      const res = await service.profitability();
      expect(res.storeRevenue).toBe(20000);
      expect(res.marketingCost).toBe(5000);
      expect(res.grossProfit).toBe(15000);
      expect(res.grossMargin).toBe(75);
      expect(res.platformSpend).toBe(1000);
      expect(res.platformOrders).toBe(10);
    });
  });

  describe('fundingPnL', () => {
    it('aggregates FUND- journal entries', async () => {
      (prisma.journalEntry.findMany as jest.Mock).mockResolvedValue([
        { id: 'je-1', entryNo: 'JE-1', entryDate: new Date(), description: 'Marketing funding', totalDebit: 12000 },
        { id: 'je-2', entryNo: 'JE-2', entryDate: new Date(), description: 'Marketing funding', totalDebit: 3000 },
      ]);
      const res = await service.fundingPnL();
      expect(res.entries).toHaveLength(2);
      expect(res.total).toBe(15000);
      expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ referenceNo: { startsWith: 'FUND-' } }) }),
      );
    });
  });

  describe('recalculateSummaries', () => {
    it('rebuilds daily summaries day-by-day from recorded rows (deterministic replace)', async () => {
      (prisma.marketingDailySummary.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });
      (prisma.marketingCampaign.findMany as jest.Mock).mockResolvedValue([
        { id: 'camp-1', adAccountId: 'acct-1' },
      ]);
      (prisma.marketingCampaignInsight.groupBy as jest.Mock).mockResolvedValue([
        { campaignId: 'camp-1', _sum: { spend: 100, purchases: 2, purchaseValue: 400 } },
      ]);
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
        { order: { total: 800 } },
      ]);
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([
        { campaignId: 'camp-1', allocatedCost: 400 },
      ]);
      (prisma.marketingDailySummary.upsert as jest.Mock).mockImplementation(async (args: any) => ({ id: 'sum-1', ...args.create }));

      const res = await service.recalculateSummaries('2026-08-01', '2026-08-03');
      expect(res.rebuilt).toBe(3);
      const upsertArgs = (prisma.marketingDailySummary.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ adAccountId_date: { adAccountId: 'acct-1', date: expect.any(Date) } });
      expect(upsertArgs.create).toMatchObject({
        spend: 100,
        orders: 1,
        revenue: 800,
        marketingCost: 400,
        profit: 400,
        roas: 8,
      });
    });
  });

  describe('intelligence', () => {
    const attribution = (over: Partial<any> = {}) => ({
      method: 'TOUCHPOINT',
      confidence: 80,
      order: {
        createdAt: new Date('2026-08-02T00:00:00Z'),
        total: 6000,
        items: [{ id: 'it-1', quantity: 1, price: 6000, product: { id: 'p-1', name: 'Tee' } }],
      },
      ...over,
    });

    const emptyAgg = () => ({ _sum: { purchases: 0 } });

    it('returns all intelligence shape keys', async () => {
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.marketingDailySummary.aggregate as jest.Mock).mockResolvedValue(emptyAgg());
      const res = await service.intelligence('2026-08-01', '2026-08-05');
      expect(Object.keys(res).sort()).toEqual([
        'attributionConfidence',
        'cac',
        'costTrend',
        'cpp',
        'explainProfit',
        'productProfitTrend',
        'range',
        'roasTrend',
        'roiTimeline',
      ]);
    });

    it('computes cac, cpp, confidence, ROAS, ROI and per-product profit from seeded rows', async () => {
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
        attribution(),
        attribution({
          confidence: 60,
          order: {
            createdAt: new Date('2026-08-02T00:00:00Z'),
            total: 4000,
            items: [{ id: 'it-2', quantity: 2, price: 2000, product: { id: 'p-1', name: 'Tee' } }],
          },
        }),
      ]);
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([
        {
          calculatedAt: new Date('2026-08-02T00:00:00Z'),
          allocatedCost: 500,
          productCosts: [
            { orderItemId: 'it-1', marketingCost: 300 },
            { orderItemId: 'it-2', marketingCost: 200 },
          ],
        },
      ]);
      (prisma.marketingDailySummary.aggregate as jest.Mock).mockResolvedValue({ _sum: { purchases: 5 } });

      const res = await service.intelligence('2026-08-01', '2026-08-05');

      expect(res.cac).toBe(250);
      expect(res.cpp).toBe(100);

      const day = res.roasTrend.find((d: any) => d.date === '2026-08-02');
      expect(day).toMatchObject({ revenue: 10000, cost: 500, roas: 20 });

      const sameDay = res.roiTimeline.find((d: any) => d.date === '2026-08-02');
      expect(sameDay).toMatchObject({ roi: 19 });

      expect(res.costTrend.find((d: any) => d.date === '2026-08-02')).toMatchObject({ cost: 500 });
      expect(res.roasTrend.find((d: any) => d.date === '2026-08-01')).toMatchObject({ roas: null });

      expect(res.attributionConfidence).toEqual({ avg: 70, byMethod: { TOUCHPOINT: 2 } });

      expect(res.productProfitTrend).toHaveLength(1);
      expect(res.productProfitTrend[0]).toMatchObject({
        productId: 'p-1',
        productName: 'Tee',
        revenue: 10000,
        cost: 500,
        profit: 9500,
        roas: 20,
      });
      expect(res.productProfitTrend[0].trend).toHaveLength(5);
      expect(res.productProfitTrend[0].trend[1]).toBe(9500);

      expect(res.explainProfit).toMatchObject({
        revenue: 10000,
        orders: 2,
        confidence: 70,
        cost: 500,
        profit: 9500,
        roas: 20,
      });
      expect(res.explainProfit.text).toContain('৳10000.00 revenue from 2 attributed orders at 70% confidence');
      expect(res.explainProfit.text).toContain('cost ৳500.00 → profit ৳9500.00 (ROAS 20.00x)');
    });

    it('sorts top products by profit desc', async () => {
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([
        attribution({
          order: {
            createdAt: new Date('2026-08-02T00:00:00Z'),
            total: 1000,
            items: [{ id: 'it-3', quantity: 1, price: 1000, product: { id: 'p-low', name: 'Low' } }],
          },
        }),
        attribution({
          order: {
            createdAt: new Date('2026-08-02T00:00:00Z'),
            total: 9000,
            items: [{ id: 'it-4', quantity: 1, price: 9000, product: { id: 'p-high', name: 'High' } }],
          },
        }),
      ]);
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([
        {
          calculatedAt: new Date('2026-08-02T00:00:00Z'),
          allocatedCost: 300,
          productCosts: [
            { orderItemId: 'it-3', marketingCost: 100 },
            { orderItemId: 'it-4', marketingCost: 200 },
          ],
        },
      ]);
      (prisma.marketingDailySummary.aggregate as jest.Mock).mockResolvedValue(emptyAgg());

      const res = await service.intelligence('2026-08-01', '2026-08-05');
      expect(res.productProfitTrend.map((p) => p.productId)).toEqual(['p-high', 'p-low']);
      expect(res.productProfitTrend[0].profit).toBe(8800);
      expect(res.productProfitTrend[1].profit).toBe(900);
    });

    it('returns zeros/empty for an empty window without throwing', async () => {
      (prisma.orderAttribution.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.marketingCostAllocation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.marketingDailySummary.aggregate as jest.Mock).mockResolvedValue(emptyAgg());

      const res = await service.intelligence('2026-08-01', '2026-08-05');
      expect(res.costTrend).toHaveLength(5);
      expect(res.costTrend.every((d: any) => d.cost === 0)).toBe(true);
      expect(res.cac).toBeNull();
      expect(res.cpp).toBeNull();
      expect(res.productProfitTrend).toEqual([]);
      expect(res.roiTimeline.every((d: any) => d.roi === null)).toBe(true);
      expect(res.attributionConfidence).toEqual({ avg: 0, byMethod: {} });
      expect(res.explainProfit.revenue).toBe(0);
      expect(res.explainProfit.profit).toBe(0);
      expect(res.explainProfit.text).toContain('ROAS N/A');
    });
  });
});