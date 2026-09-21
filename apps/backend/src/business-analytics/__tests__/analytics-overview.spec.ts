/**
 * P3 tests — analytics overview service (§3.1 composition, §4.2 overview rows).
 *
 * No formula lives in the overview service: trend buckets and the comparison
 * window re-run computePnl (P1 contract) over the same inputs with different
 * ranges; breakdowns use allocateDiscount. These tests assert the composition
 * contract: reuse of P2 services, one round-trip per group, Dhaka buckets,
 * top-N breakdowns with channel/source never merged, and cache read-through.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import {
  AnalyticsOverviewService,
  bucketEdges,
  fittingGranularity,
  OVERVIEW_BREAKDOWN_TOP_N,
  OVERVIEW_TREND_BUCKET_CAP,
} from '../analytics-overview.service';
import { AnalyticsFilterService } from '../analytics-filter.service';
import { AnalyticsPnlService } from '../analytics-pnl.service';
import { AnalyticsFulfillmentService } from '../analytics-fulfillment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

function deliveredTimeline(at: string) {
  return [
    { status: 'Confirmed', timestamp: '2026-09-01T04:00:00.000Z' },
    { status: 'Delivered', timestamp: at },
  ];
}

function orderRow(over: Record<string, any> = {}) {
  return {
    id: 'o1',
    total: 1000,
    subtotal: 1000,
    shippingCharge: 60,
    discount: 0,
    discountType: 'flat',
    source: 'ECOMMERCE',
    salesChannel: 'WEBSITE',
    status: { name: 'Delivered' },
    timeline: deliveredTimeline('2026-09-03T06:00:00.000Z'),
    createdAt: new Date('2026-09-01T04:00:00.000Z'),
    paymentOptionType: 'FULL_PAYMENT',
    customerId: null,
    customerPhone: null,
    guestPhone: null,
    items: [
      {
        price: 1000,
        quantity: 1,
        product: {
          category: { id: 'c1', name: 'Grocery' },
          productCategories: [],
        },
        comboComponents: [],
      },
    ],
    payments: [],
    refunds: [],
    dispatches: [],
    ...over,
  };
}

const pnlEnvelope: any = {
  data: {
    lines: { netSales: { value: 1000, state: 'ok' } },
    margins: { gross: 0.5, contribution: 0.4, operating: 0.3, net: 0.3 },
    bridge: { contributionProfit: 400, deliveryChargeRetained: 60, operands: ['contributionProfit', 'deliveryChargeRetained'] },
    lenses: {},
    strip: {},
    coverage: {},
    marketing: {},
  },
  meta: {
    costCoverage: {},
    ladderState: 'actual',
    formulaVersion: 'analytics-p2/1.0',
  },
};

const fulfillmentEnvelope: any = {
  data: {
    totals: { collected: 1000, refunded: 0, retained: 1000, courierCost: 50, deliveryChargeRetained: 60, fulfillmentMargin: 10 },
    coverage: { onlineOrders: 1, codOrders: 0, collectionUnavailableOrders: 0, unknownAmount: 0 },
    gapBanner: { codOrders: 0, courierCost: 0, message: '' },
    panelNote: 'Not part of recognised revenue',
  },
  meta: {},
};

describe('AnalyticsOverviewService', () => {
  let service: AnalyticsOverviewService;
  let cache: { get: jest.Mock; set: jest.Mock };
  const mockPrisma: any = {
    order: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
  };
  const mockFilter: any = {
    resolveContext: jest.fn(),
    buildOrderWhere: jest.fn(),
    resolveMarketingOrderIds: jest.fn(),
    segmentOf: jest.fn(),
  };
  const mockPnl: any = { getPnl: jest.fn() };
  const mockFulfillment: any = { getFulfillment: jest.fn() };

  const range = {
    start: new Date('2026-09-01T00:00:00+06:00'),
    end: new Date('2026-09-07T17:59:59.999Z'),
    periodDays: 7,
    granularity: 'day' as const,
    comparison: {
      prevStart: new Date('2026-08-25T00:00:00+06:00'),
      prevEnd: new Date('2026-08-31T17:59:59.999Z'),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    mockFilter.resolveContext.mockReturnValue({ range, filters: {} });
    mockFilter.buildOrderWhere.mockReturnValue({ trashedAt: null });
    mockPrisma.order.findMany.mockResolvedValue([orderRow()]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPnl.getPnl.mockResolvedValue(pnlEnvelope);
    mockFulfillment.getFulfillment.mockResolvedValue(fulfillmentEnvelope);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsOverviewService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsFilterService, useValue: mockFilter },
        { provide: AnalyticsPnlService, useValue: mockPnl },
        { provide: AnalyticsFulfillmentService, useValue: mockFulfillment },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    service = module.get(AnalyticsOverviewService);
  });

  it('composes pnl + fulfillment from the P2 services (no formula duplication)', async () => {
    const res = await service.getOverview({} as any);
    expect(mockPnl.getPnl).toHaveBeenCalledTimes(1);
    expect(mockFulfillment.getFulfillment).toHaveBeenCalledTimes(1);
    expect(res.data.pnl).toBe(pnlEnvelope.data);
    expect(res.data.fulfillment.totals).toEqual(fulfillmentEnvelope.data.totals);
    expect(res.data.fulfillment.coverage).toEqual(fulfillmentEnvelope.data.coverage);
    expect(res.data.fulfillment.gapBanner).toEqual(fulfillmentEnvelope.data.gapBanner);
  });

  it('issues one round-trip per logical group', async () => {
    await service.getOverview({} as any);
    // orders (trend/breakdown/comparison) + booked span + cash span.
    expect(mockPrisma.order.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledTimes(1);
  });

  it('scopes the cash span to PAID payments across comparison + current', async () => {
    await service.getOverview({} as any);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PaymentStatus.PAID,
          createdAt: { gte: range.comparison.prevStart, lte: range.end },
        }),
      }),
    );
  });

  it('emits one trend point per Dhaka day with the recognised order inside its bucket', async () => {
    const res = await service.getOverview({ preset: 'custom' } as any);
    expect(res.data.trend.granularity).toBe('day');
    expect(res.data.trend.points).toHaveLength(7);
    const dated = res.data.trend.points.filter((p) => p.recognisedOrders > 0);
    expect(dated).toHaveLength(1);
    expect(dated[0].netSales).toBe(1000);
    expect(res.data.trend.points.reduce((s, p) => s + p.netSales, 0)).toBe(1000);
  });

  it('reports the previous-window comparison with delta + pct', async () => {
    const res = await service.getOverview({} as any);
    expect(res.data.comparison.prevNetSales).toBe(0);
    expect(res.data.comparison.prevRecognisedOrders).toBe(0);
    expect(res.data.comparison.netSalesDelta).toBe(1000);
    // Null-denominator pct is null, never Infinity.
    expect(res.data.comparison.netSalesDeltaPct).toBeNull();
  });

  it('keeps channel and source breakdowns separate (never merged)', async () => {
    const res = await service.getOverview({} as any);
    expect(res.data.breakdowns.bySalesChannel).toEqual([
      { key: 'WEBSITE', label: 'WEBSITE', netSales: 1000, orders: 1 },
    ]);
    expect(res.data.breakdowns.bySource).toEqual([
      { key: 'ECOMMERCE', label: 'ECOMMERCE', netSales: 1000, orders: 1 },
    ]);
    expect(res.data.breakdowns.byCategory).toEqual([
      { key: 'c1', label: 'Grocery', netSales: 1000, orders: 1 },
    ]);
  });

  it('folds categories beyond top-N into a single Other row', async () => {
    const orders = Array.from({ length: OVERVIEW_BREAKDOWN_TOP_N + 3 }, (_, i) =>
      orderRow({
        id: `o${i}`,
        timeline: deliveredTimeline(`2026-09-0${(i % 6) + 1}T06:00:00.000Z`),
        items: [
          {
            price: 100,
            quantity: 1,
            product: { category: { id: `cx${i}`, name: `Cat ${i}` }, productCategories: [] },
            comboComponents: [],
          },
        ],
      }),
    );
    mockPrisma.order.findMany.mockResolvedValueOnce(orders).mockResolvedValueOnce([]);
    const res = await service.getOverview({} as any);
    const cats = res.data.breakdowns.byCategory;
    expect(cats).toHaveLength(OVERVIEW_BREAKDOWN_TOP_N + 1);
    expect(cats[cats.length - 1].key).toBe('other');
    expect(cats[cats.length - 1].label).toContain('Other (3)');
  });

  it('serves the cached overview without touching Prisma or P2 services', async () => {
    cache.get.mockResolvedValueOnce({ data: 'cached', meta: {} });
    const res = await service.getOverview({} as any);
    expect(res).toEqual({ data: 'cached', meta: {} });
    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
    expect(mockPnl.getPnl).not.toHaveBeenCalled();
  });

  it('carries auditability meta (formulaVersion + ladderState + dateBasis)', async () => {
    const res = await service.getOverview({} as any);
    expect(res.meta.formulaVersion).toBe('analytics-p2/1.0');
    expect(res.meta.ladderState).toBe('actual');
    expect(res.meta.dateBasis).toContain('Delivered');
    expect(res.meta.thresholds).toMatchObject({ breakdownTopN: OVERVIEW_BREAKDOWN_TOP_N });
  });
});

describe('bucketEdges', () => {
  const start = new Date('2026-09-01T00:00:00+06:00');
  const end = new Date('2026-09-03T17:59:59.999Z');

  it('partitions days on Dhaka midnights with Dhaka labels', () => {
    const edges = bucketEdges(start, end, 'day');
    expect(edges).toHaveLength(3);
    expect(edges[0].label).toBe('2026-09-01');
    expect(edges[2].label).toBe('2026-09-03');
    expect(edges[1].start.getTime()).toBe(edges[0].end.getTime() + 1);
  });

  it('emits 24 hour buckets per Dhaka day', () => {
    const edges = bucketEdges(start, new Date('2026-09-01T17:59:59.999Z'), 'hour');
    expect(edges).toHaveLength(24);
    expect(edges[0].label).toContain('00:00');
  });

  it('steps months on the Dhaka calendar', () => {
    const edges = bucketEdges(
      new Date('2026-01-15T00:00:00+06:00'),
      new Date('2026-03-10T17:59:59.999Z'),
      'month',
    );
    expect(edges.map((e) => e.label)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('fittingGranularity', () => {
  it('keeps the requested granularity when buckets fit the cap', () => {
    const start = new Date('2026-09-01T00:00:00+06:00');
    const end = new Date('2026-09-07T17:59:59.999Z');
    expect(fittingGranularity(start, end, 'day')).toBe('day');
  });

  it('steps a two-year daily request up to month so buckets stay under the cap', () => {
    const start = new Date('2024-09-01T00:00:00+06:00');
    const end = new Date('2026-09-01T17:59:59.999Z');
    const fitted = fittingGranularity(start, end, 'day');
    expect(fitted).not.toBe('day');
    expect(bucketEdges(start, end, fitted).length).toBeLessThanOrEqual(
      OVERVIEW_TREND_BUCKET_CAP,
    );
  });
});
