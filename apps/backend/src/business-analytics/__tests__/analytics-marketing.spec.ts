/**
 * P7 marketing analytics tests (§2.4 spend-date strictness, §4.3 R7/R8 inputs,
 * §7.1 marketing-date + §8.13/8.14 disclosures).
 *
 * Pure compute fns over fixtures + service fetch wiring (trashed excluded,
 * allocatedAt never a date — asserted behaviourally) + disclosure strings.
 * P&L cost reuses P1 marketingPeriodCost; this suite locks the P7 mapping
 * (allocatedAt dropped structurally) and the attribution-view bases.
 */
import {
  computeMarketingCost,
  toFinancialConsumptionRows,
  aggregateSourceRevenue,
  computeSegmentRevenue,
  computeUnrecognisedSpend,
  buildCampaignTree,
  SPEND_DATE_BASIS_STATEMENT,
  ALLOCATED_AT_NOTE,
  ATTRIBUTION_MISMATCH_STATEMENT,
  UNRECOGNISED_SPEND_NOTE,
  UNDATED_FIX_ACTIONS,
  TREE_INSIGHTS_BASIS,
  TREE_STORE_BASIS,
  TREE_PNL_BASIS,
} from '../analytics-marketing.service';
import { AnalyticsMarketingService } from '../analytics-marketing.service';
import { AnalyticsFilterService } from '../analytics-filter.service';

const NOW = new Date();
const RANGE = {
  start: new Date(NOW.getTime() - 30 * 24 * 3600 * 1000),
  end: new Date(NOW.getTime() + 24 * 3600 * 1000),
};
const IN_RANGE = new Date(NOW.getTime() - 5 * 24 * 3600 * 1000);
const OUT_OF_RANGE = new Date(NOW.getTime() - 90 * 24 * 3600 * 1000);

// ─── spend-date-only P&L cost (P1 reuse) ─────────────────────────────────────

describe('computeMarketingCost (spendDate only)', () => {
  it('sums dated rows in range as actual', () => {
    const cost = computeMarketingCost(
      [
        { calculatedCost: 500, spendDate: IN_RANGE },
        { calculatedCost: 300, spendDate: IN_RANGE },
      ],
      RANGE,
    );
    expect(cost.total).toBe(800);
    expect(cost.state).toBe('actual');
    expect(cost.datedRows).toBe(2);
    expect(cost.undatedRows).toBe(0);
    expect(cost.estimatedReference).toBeNull();
  });

  it('excludes NULL-spendDate rows from every period total: 0 + unavailable + quantified', () => {
    const cost = computeMarketingCost(
      [{ calculatedCost: 200, spendDate: null }],
      RANGE,
    );
    expect(cost.total).toBe(0);
    expect(cost.state).toBe('unavailable');
    expect(cost.undatedRows).toBe(1);
    expect(cost.undatedAmount).toBe(200);
    expect(cost.estimatedReference).toEqual({
      label: expect.any(String),
      excludedFromTotal: true,
    });
  });

  it('mixed rows: dated sum only, undated quantified alongside', () => {
    const cost = computeMarketingCost(
      [
        { calculatedCost: 500, spendDate: IN_RANGE },
        { calculatedCost: 200, spendDate: null },
      ],
      RANGE,
    );
    expect(cost.total).toBe(500);
    expect(cost.datedAmount).toBe(500);
    expect(cost.state).toBe('unavailable');
    expect(cost.undatedRows).toBe(1);
    expect(cost.undatedAmount).toBe(200);
  });

  it('allocatedAt is never a financial date (behavioural)', () => {
    // Undated row whose allocatedAt falls in range: still 0, still unavailable.
    const undatedButAllocatedInRange = computeMarketingCost(
      [{ calculatedCost: 200, spendDate: null, allocatedAt: IN_RANGE }],
      RANGE,
    );
    expect(undatedButAllocatedInRange.total).toBe(0);
    expect(undatedButAllocatedInRange.undatedRows).toBe(1);
    // Dated-out-of-range row whose allocatedAt falls in range: still excluded.
    const datedOutAllocatedIn = computeMarketingCost(
      [{ calculatedCost: 700, spendDate: OUT_OF_RANGE, allocatedAt: IN_RANGE }],
      RANGE,
    );
    expect(datedOutAllocatedIn.total).toBe(0);
    expect(datedOutAllocatedIn.datedRows).toBe(0);
    expect(datedOutAllocatedIn.state).toBe('actual');
  });

  it('drops allocatedAt/calculatedAt structurally before the P1 sum', () => {
    const rows = toFinancialConsumptionRows([
      {
        calculatedCost: 100,
        spendDate: IN_RANGE,
        allocatedAt: IN_RANGE,
        calculatedAt: IN_RANGE,
      },
    ]);
    expect(rows).toEqual([{ calculatedCost: 100, spendDate: IN_RANGE }]);
    expect('allocatedAt' in rows[0]).toBe(false);
    expect('calculatedAt' in rows[0]).toBe(false);
  });
});

// ─── source & channel revenue ────────────────────────────────────────────────

describe('aggregateSourceRevenue', () => {
  it('groups by source and channel, unattributed counted separately', () => {
    const r = aggregateSourceRevenue([
      { source: 'facebook', channel: 'FACEBOOK', revenue: 1000 },
      { source: 'facebook', channel: 'FACEBOOK', revenue: 500 },
      { source: 'unattributed', channel: 'WALK_IN', revenue: 250 },
    ]);
    expect(r.sources[0]).toMatchObject({ key: 'facebook', orders: 2, revenue: 1500 });
    expect(r.unattributed).toEqual({ orders: 1, revenue: 250 });
    expect(r.channels).toHaveLength(2);
    expect(r.total).toEqual({ orders: 3, revenue: 1750 });
  });

  it('falls back to utmSource before unattributed (resolution order)', () => {
    const r = aggregateSourceRevenue([
      { source: 'google', channel: 'CALL', revenue: 400 },
    ]);
    expect(r.unattributed).toEqual({ orders: 0, revenue: 0 });
    expect(r.sources[0].key).toBe('google');
  });
});

// ─── new vs returning split ──────────────────────────────────────────────────

describe('computeSegmentRevenue', () => {
  const at = (iso: string) => new Date(iso);
  const range = { start: at('2026-09-01T00:00:00+06:00'), end: at('2026-09-30T23:59:59.999+06:00') };

  it('splits first-ever-in-range (new) from pre-range (returning)', () => {
    const r = computeSegmentRevenue(
      [
        { key: 'customer:N', at: at('2026-09-10T10:00:00+06:00'), revenue: 1000 },
        { key: 'customer:R', at: at('2026-08-05T10:00:00+06:00'), revenue: 2000 },
        { key: 'customer:R', at: at('2026-09-12T10:00:00+06:00'), revenue: 500 },
      ],
      range,
    );
    expect(r.newOrders).toBe(1);
    expect(r.newRevenue).toBe(1000);
    expect(r.returningOrders).toBe(1);
    expect(r.returningRevenue).toBe(500);
  });

  it('reports VIP as an of-which subset of returning, never a third bucket', () => {
    const events = Array.from({ length: 5 }, (_, k) => ({
      key: 'customer:V',
      at: at(`2026-0${k < 4 ? '8-1' : '9-1'}${k}T10:00:00+06:00`),
      revenue: 100,
    }));
    const r = computeSegmentRevenue(events, range);
    expect(r.returningRevenue).toBeGreaterThan(0);
    expect(r.vipRevenue).toBeLessThanOrEqual(r.returningRevenue);
    expect(r.newRevenue + r.returningRevenue).toBe(
      events
        .filter((e) => e.at >= range.start && e.at <= range.end)
        .reduce((s, e) => s + e.revenue, 0),
    );
  });
});

// ─── never-recognised spend insight ──────────────────────────────────────────

describe('computeUnrecognisedSpend', () => {
  const cancelled = {
    orderId: 'ox',
    displayId: 'ORD-X',
    status: 'Cancelled',
    timeline: [],
    dispatchDeliveredAt: null,
    allocatedCost: 50,
    calculatedAt: IN_RANGE,
    campaignId: 'c1',
    campaignName: 'Camp',
  };
  const delivered = {
    ...cancelled,
    orderId: 'ok',
    displayId: 'ORD-OK',
    status: 'Delivered',
    timeline: [{ status: 'Delivered', timestamp: IN_RANGE }],
    allocatedCost: 70,
  };

  it('counts cancelled/undelivered allocations, excludes recognised orders', () => {
    const r = computeUnrecognisedSpend([cancelled, delivered]);
    expect(r.amount).toBe(50);
    expect(r.allocations).toBe(1);
    expect(r.orders).toBe(1);
    expect(r.rows[0]).toMatchObject({ orderId: 'ox', allocatedCost: 50 });
  });
});

// ─── campaign tree assembly ──────────────────────────────────────────────────

describe('buildCampaignTree (recorded rows, never recomputed)', () => {
  const tree = buildCampaignTree({
    campaigns: [
      {
        id: 'c1',
        name: 'C1',
        status: 'ACTIVE',
        adAccount: { id: 'a1', name: 'A1', currency: 'BDT' },
        platform: { slug: 'facebook', name: 'Facebook' },
      },
    ],
    adSets: [{ id: 's1', campaignId: 'c1', name: 'S1', status: 'ACTIVE' }],
    ads: [{ id: 'ad1', adSetId: 's1', name: 'AD1', status: 'ACTIVE' }],
    campaignInsights: [
      { campaignId: 'c1', spend: 100, impressions: 10, clicks: 2, purchases: 1, purchaseValue: 500 },
      { campaignId: 'c1', spend: 50, impressions: 5, clicks: 1, purchases: 0, purchaseValue: 0 },
    ],
    adSetInsights: [
      { adSetId: 's1', spend: 150, impressions: 15, clicks: 3, purchases: 1, purchaseValue: 500 },
    ],
    adInsights: [
      { adId: 'ad1', spend: 150, impressions: 15, clicks: 3, purchases: 1, purchaseValue: 500 },
    ],
    attributed: [
      { campaignId: 'c1', adSetId: 's1', adId: 'ad1', revenue: 1000 },
      { campaignId: 'c1', adSetId: 's1', adId: null, revenue: 250 },
    ],
    pnlCostByCampaign: { c1: 140 },
    undatedByCampaign: { c1: { amount: 20, rows: 1 } },
  });

  it('sums recorded insights and intake attributions per level with stated bases', () => {
    expect(tree).toHaveLength(1);
    const [c] = tree;
    expect(c.insights.spend).toBe(150);
    expect(c.store).toEqual({ orders: 2, revenue: 1250 });
    expect(c.pnlCost).toBe(140);
    expect(c.undatedCost).toEqual({ amount: 20, rows: 1 });
    expect(c.insightsDateBasis).toBe(TREE_INSIGHTS_BASIS);
    expect(c.storeDateBasis).toBe(TREE_STORE_BASIS);
    expect(c.pnlDateBasis).toBe(TREE_PNL_BASIS);
    expect(c.adSets[0].store).toEqual({ orders: 2, revenue: 1250 });
    expect(c.adSets[0].ads[0].store).toEqual({ orders: 1, revenue: 1000 });
  });
});

// ─── disclosure strings ──────────────────────────────────────────────────────

describe('P7 disclosures', () => {
  it('states spend-date strictness, allocatedAt honesty and the expected mismatch', () => {
    expect(SPEND_DATE_BASIS_STATEMENT).toMatch(/spendDate/);
    expect(ALLOCATED_AT_NOTE).toMatch(/never financial dates/);
    expect(ATTRIBUTION_MISMATCH_STATEMENT).toMatch(/expected by design/);
    expect(UNRECOGNISED_SPEND_NOTE).toMatch(/never folded into the P&L ladder/);
    expect(UNDATED_FIX_ACTIONS.map((a) => a.href)).toEqual([
      '/op/marketing/spend-snapshots',
      '/op/marketing/attribution',
    ]);
  });
});

// ─── service wiring ──────────────────────────────────────────────────────────

function mockPrisma(over: Record<string, any> = {}): any {
  return {
    marketingConsumption: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { calculatedCost: 0 } }),
    },
    order: { findMany: jest.fn().mockResolvedValue([]) },
    marketingSession: { findMany: jest.fn().mockResolvedValue([]) },
    marketingCostAllocation: { findMany: jest.fn().mockResolvedValue([]) },
    marketingCampaignInsight: { findMany: jest.fn().mockResolvedValue([]) },
    marketingAdSetInsight: { findMany: jest.fn().mockResolvedValue([]) },
    marketingAdInsight: { findMany: jest.fn().mockResolvedValue([]) },
    orderAttribution: { findMany: jest.fn().mockResolvedValue([]) },
    marketingCampaign: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
}

function service(prisma: any) {
  const filters = new AnalyticsFilterService(prisma);
  const cache: any = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
  return new AnalyticsMarketingService(prisma, filters, cache);
}

describe('AnalyticsMarketingService fetch wiring', () => {
  it('excludes trashed orders and scopes allocations to non-trashed orders', async () => {
    const prisma = mockPrisma();
    await service(prisma).getSummary({ preset: 'last_30_days' } as any);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ trashedAt: null }),
      }),
    );
    expect(prisma.marketingCostAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ order: { trashedAt: null } }),
      }),
    );
  });

  it('fetches consumptions by spendDate-or-NULL (allocatedAt never a predicate)', async () => {
    const prisma = mockPrisma();
    await service(prisma).getSummary({ preset: 'last_30_days' } as any);
    const where = prisma.marketingConsumption.findMany.mock.calls[0][0].where;
    expect(where).toHaveProperty('OR');
    expect(JSON.stringify(where)).not.toMatch(/allocatedAt/);
    expect(JSON.stringify(where)).not.toMatch(/calculatedAt/);
  });

  it('keeps the insight amount out of the P&L cost total (insight only, never ladder)', async () => {
    const now = new Date();
    const prisma = mockPrisma({
      marketingConsumption: {
        findMany: jest.fn().mockResolvedValue([
          { calculatedCost: 500, spendDate: now },
        ]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { calculatedCost: 0 } }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'o1',
            subtotal: 1000,
            discount: 0,
            discountType: 'flat',
            status: { name: 'Delivered' },
            timeline: [{ status: 'Delivered', timestamp: now }],
            customerId: 'C1',
            customerPhone: null,
            guestPhone: null,
            salesChannel: 'FACEBOOK',
            trackingSessionId: null,
            items: [{ price: 1000, quantity: 1 }],
            dispatches: [],
            orderAttribution: null,
          },
        ]),
      },
      marketingCostAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            allocatedCost: 50,
            calculatedAt: now,
            campaignId: 'c1',
            campaign: { name: 'Camp' },
            order: {
              id: 'ox',
              displayId: 'ORD-X',
              status: { name: 'Cancelled' },
              timeline: [],
              dispatches: [],
            },
          },
        ]),
      },
    });
    const res: any = await service(prisma).getSummary({ preset: 'last_30_days' } as any);
    // P&L cost is the dated consumption alone; the insight lives beside it.
    expect(res.data.cost.total).toMatchObject({ value: 500, state: 'ok' });
    expect(res.data.unrecognisedSpend.amount).toBe(50);
    expect(res.data.cost.total.value).not.toBe(550);
    // Recognised revenue by source: unattributed fallback, Delivered basis.
    expect(res.data.sources.rows[0]).toMatchObject({ key: 'unattributed', revenue: 1000 });
    expect(res.data.sources.dateBasis).toMatch(/Delivered/);
    expect(res.data.segments.newRevenue).toBe(1000);
    expect(res.data.attributionDisclosure).toMatch(/expected by design/);
  });

  it('marks the cost unavailable when an undated row exists, with the fix-list action', async () => {
    const now = new Date();
    const prisma = mockPrisma({
      marketingConsumption: {
        findMany: jest.fn().mockResolvedValue([
          { calculatedCost: 500, spendDate: now },
          { calculatedCost: 200, spendDate: null },
        ]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { calculatedCost: 200 } }),
      },
    });
    const res: any = await service(prisma).getSummary({ preset: 'last_30_days' } as any);
    expect(res.data.cost.total.state).toBe('unavailable');
    expect(res.data.cost.total.value).toBe(500);
    expect(res.data.cost.undatedAmount).toBe(200);

    const undated: any = await service(prisma).getUndated({ preset: 'last_30_days' } as any);
    expect(undated.data.fixActions).toHaveLength(2);
    expect(undated.data.allocatedAtNote).toMatch(/never financial dates/);
  });
});
