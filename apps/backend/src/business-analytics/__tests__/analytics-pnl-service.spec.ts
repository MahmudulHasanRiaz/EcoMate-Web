/**
 * P2 data-layer tests — analytics service fetch wiring.
 *
 * Filters land in SQL (trashed excluded always; PAID-only cash query;
 * spendDate never filtered — undated rows must be visible to quantify).
 * One round-trip per logical group via Promise.all; cache read-through.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import { AnalyticsPnlService } from '../analytics-pnl.service';
import { AnalyticsFulfillmentService } from '../analytics-fulfillment.service';
import { AnalyticsFilterService } from '../analytics-filter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

describe('AnalyticsPnlService fetch wiring', () => {
  let service: AnalyticsPnlService;
  let cache: { get: jest.Mock; set: jest.Mock };
  const mockPrisma: any = {
    order: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    marketingConsumption: { findMany: jest.fn() },
    expense: { findMany: jest.fn() },
  };
  const mockFilter: any = {
    resolveContext: jest.fn(),
    buildOrderWhere: jest.fn(),
    resolveMarketingOrderIds: jest.fn(),
    segmentOf: jest.fn(),
  };
  const mockFulfillment: any = {
    buildSettlementSource: jest.fn().mockReturnValue({
      getCodCollection: jest.fn().mockReturnValue({ state: 'unavailable' }),
    }),
  };

  const range = {
    start: new Date('2026-09-01T00:00:00+06:00'),
    end: new Date('2026-09-30T17:59:59.999Z'),
    periodDays: 30,
    granularity: 'day',
    comparison: { prevStart: new Date(), prevEnd: new Date() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    mockFilter.resolveContext.mockReturnValue({ range, filters: {} });
    mockFilter.buildOrderWhere.mockReturnValue({ trashedAt: null });
    mockPrisma.order.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.marketingConsumption.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsPnlService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsFilterService, useValue: mockFilter },
        { provide: CacheService, useValue: cache },
        { provide: AnalyticsFulfillmentService, useValue: mockFulfillment },
      ],
    }).compile();
    service = module.get(AnalyticsPnlService);
  });

  it('excludes trashed orders in every order query', async () => {
    await service.getPnl({} as any);
    for (const call of mockPrisma.order.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ trashedAt: null });
    }
  });

  it('scopes the cash query to PAID payments in range', async () => {
    await service.getPnl({} as any);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PaymentStatus.PAID,
          createdAt: { gte: range.start, lte: range.end },
        }),
      }),
    );
  });

  it('fetches consumptions with an exact shape: spendDate range OR NULL (undated rows stay quantifiable)', async () => {
    await service.getPnl({} as any);
    expect(
      mockPrisma.marketingConsumption.findMany,
    ).toHaveBeenCalledWith({
      where: {
        OR: [
          { spendDate: { gte: range.start, lte: range.end } },
          { spendDate: null },
        ],
      },
      select: { calculatedCost: true, spendDate: true },
    });
  });

  it('bounds the candidate fetch with a wider-window createdAt predicate (precise recognition stays in JS)', async () => {
    await service.getPnl({} as any);
    const candidatesCall = mockPrisma.order.findMany.mock.calls[0][0];
    expect(candidatesCall.where).toMatchObject({
      trashedAt: null,
      createdAt: { lte: range.end },
    });
    // No lower bound: old orders deliver in range (cross-period cohort).
    expect(candidatesCall.where.createdAt.gte).toBeUndefined();
  });

  it('resolves marketing source ids DB-side before constraining', async () => {
    mockFilter.resolveContext.mockReturnValue({
      range,
      filters: { marketingSource: 'meta' },
    });
    mockFilter.resolveMarketingOrderIds.mockResolvedValue(['o1']);
    mockFilter.buildOrderWhere.mockReturnValue({
      trashedAt: null,
      id: { in: ['o1'] },
    });
    await service.getPnl({ marketingSource: 'meta' } as any);
    expect(mockFilter.resolveMarketingOrderIds).toHaveBeenCalledWith('meta');
    expect(mockFilter.buildOrderWhere).toHaveBeenCalledWith(
      { marketingSource: 'meta' },
      ['o1'],
    );
  });

  it('serves cached responses without touching the database', async () => {
    cache.get.mockResolvedValueOnce({ data: 'cached', meta: 'm' });
    const res = await service.getPnl({} as any);
    expect(res).toEqual({ data: 'cached', meta: 'm' });
    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
  });

  it('returns no_data envelopes when nothing is recognised', async () => {
    const res = await service.getPnl({} as any);
    expect(res.data.lines.netSales.state).toBe('no_data');
    expect(res.data.lines.netSales.value).toBeNull();
    expect(res.meta.formulaVersion).toBeDefined();
    expect(res.meta.ladderState).toBeDefined();
  });

  it('serves the computed response when the cache write blips', async () => {
    cache.set.mockRejectedValueOnce(new Error('redis down'));
    const res = await service.getPnl({} as any);
    expect(res.data.lines.netSales.state).toBe('no_data');
    expect(res.meta.formulaVersion).toBeDefined();
  });

  it('marks zero with missing inputs unavailable (not ok-zero); measured zeroes stay zero', async () => {
    mockPrisma.order.findMany.mockImplementation(async (args: any) => {
      // Candidates (unfiltered select) vs booked (createdAt select).
      if (args.select?.timeline) {
        return [
          {
            id: 'o1',
            total: 1000,
            subtotal: 1000,
            shippingCharge: 80,
            discount: 0,
            discountType: 'flat',
            status: { name: 'Delivered' },
            timeline: [
              { status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' },
            ],
            createdAt: new Date('2026-09-01T00:00:00+06:00'),
            paymentOptionType: 'FULL_PAYMENT',
            customerId: null,
            customerPhone: null,
            guestPhone: null,
            shippingCost: 60,
            shippingCostSource: 'manual',
            items: [
              {
                price: 500,
                quantity: 2,
                costSnapshot: 60,
                costType: 'actual',
              },
            ],
            payments: [
              {
                amount: 1000,
                status: PaymentStatus.PAID,
                gatewayCode: 'bkash',
                feeAmount: null,
                createdAt: new Date('2026-09-11T10:00:00+06:00'),
              },
            ],
            refunds: [],
            dispatches: [],
          },
        ];
      }
      return [];
    });
    const res = await service.getPnl({} as any);
    // Zero fees with a missing feeAmount: unavailable, not ok-zero.
    expect(res.data.lines.paymentFees).toMatchObject({
      value: 0,
      state: 'unavailable',
    });
    expect(res.data.lines.paymentFees.reason).toBeTruthy();
    // Measured zero with full inputs: discounts are actually 0 → zero.
    expect(res.data.lines.discounts).toMatchObject({
      value: 0,
      state: 'zero',
    });
  });

  it('fetches received returns with the order cohort (item-level deductions)', async () => {
    await service.getPnl({} as any);
    const select = mockPrisma.order.findMany.mock.calls[0][0].select;
    expect(select.returns).toEqual(
      expect.objectContaining({
        where: { status: { in: ['RECEIVED', 'RESTOCKED', 'CLOSED'] } },
      }),
    );
    expect(select.items.select).toEqual(
      expect.objectContaining({ productId: true, variantId: true }),
    );
  });

  it('loads COD settlement once for the recognised candidate set', async () => {
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 'cod-1',
        total: 1000,
        subtotal: 900,
        shippingCharge: 100,
        discount: 0,
        discountType: 'flat',
        status: { name: 'Delivered' },
        timeline: [
          { status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' },
        ],
        createdAt: new Date('2026-09-01T10:00:00+06:00'),
        paymentOptionType: 'CASH_ON_DELIVERY',
        customerId: null,
        customerPhone: null,
        guestPhone: null,
        shippingCost: 80,
        shippingCostSource: 'manual',
        items: [],
        payments: [],
        refunds: [],
        returns: [],
        dispatches: [],
      },
    ]);
    await service.getPnl({} as any);
    expect(mockFulfillment.buildSettlementSource).toHaveBeenCalledTimes(1);
    expect(mockFulfillment.buildSettlementSource).toHaveBeenCalledWith(['cod-1']);
  });

  // ── Finding 8 (2026-11-12): costNotSet exposure + specific ladder reason ──

  it('exposes the costNotSet bucket and names the missing ladder input (staging manual order)', async () => {
    mockPrisma.order.findMany.mockImplementation(async (args: any) => {
      if (args.select?.timeline) {
        return [
          {
            id: 'o-manual',
            total: 550,
            subtotal: 550,
            shippingCharge: 0,
            discount: 0,
            discountType: 'flat',
            status: { name: 'Delivered' },
            timeline: [
              { status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' },
            ],
            createdAt: new Date('2026-09-10T00:00:00+06:00'),
            paymentOptionType: 'FULL_PAYMENT',
            customerId: null,
            customerPhone: null,
            guestPhone: null,
            // No courier/shipping cost was ever recorded for this order —
            // genuinely missing data, not a code error.
            shippingCost: null,
            shippingCostSource: null,
            items: [
              {
                productId: null,
                variantId: null,
                price: 200,
                quantity: 2,
                costSnapshot: 120,
                costType: 'actual',
                isManual: true,
                manualName: 'Custom Gift Wrap Service',
                addonAmount: 0,
                addonCostAmount: 0,
              },
              {
                productId: null,
                variantId: null,
                price: 150,
                quantity: 1,
                costSnapshot: 150,
                costType: 'not_set',
                isManual: true,
                manualName: 'Handwritten Note Card',
                addonAmount: 0,
                addonCostAmount: 0,
              },
            ],
            payments: [],
            refunds: [],
            returns: [],
            dispatches: [],
          },
        ];
      }
      return [];
    });
    const res = await service.getPnl({} as any);
    // The bucket is in the envelope now (it was computed but dropped).
    expect(res.data.costNotSet).toEqual({ units: 1, amount: 150, lines: 1 });
    // COGS counts the not_set line at full price — never 'unavailable'
    // (envelope maps CostState 'actual' to KPI state 'ok').
    expect(res.data.lines.cogs.state).toBe('ok');
    expect(res.data.lines.cogs.value).toBe(390);
    // Gross Profit depends ONLY on netSales + COGS: the ladder is
    // unavailable ONLY because the shipping cost is missing, and that is a
    // downstream input — it must not mark Gross Profit unavailable (staging
    // 2026-11-12: the waterfall showed ৳160 + Unavailable badge while the
    // KPI card hid the number). Gross Profit is ok at 550 − 390 = ৳160.
    expect(res.data.lines.grossProfit).toMatchObject({ value: 160, state: 'ok' });
    expect(res.data.lines.grossProfit.reason).toBeUndefined();
    // Net Profit DOES consume the ladder, so it stays unavailable and its
    // reason still names the missing shipping cost.
    expect(res.data.lines.netProfit.state).toBe('unavailable');
    expect(res.data.lines.netProfit.reason).toContain(
      'shipping cost missing on 1 recognised order(s)',
    );
  });

  it('gross profit is unavailable ONLY when its own input (COGS) is missing', async () => {
    mockPrisma.order.findMany.mockImplementation(async (args: any) => {
      if (args.select?.timeline) {
        return [
          {
            id: 'o-nocost',
            total: 300,
            subtotal: 300,
            shippingCharge: 0,
            discount: 0,
            discountType: 'flat',
            status: { name: 'Delivered' },
            timeline: [
              { status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' },
            ],
            createdAt: new Date('2026-09-10T00:00:00+06:00'),
            paymentOptionType: 'FULL_PAYMENT',
            customerId: null,
            customerPhone: null,
            guestPhone: null,
            shippingCost: 60,
            shippingCostSource: 'manual',
            items: [
              {
                productId: 'p1',
                variantId: null,
                price: 100,
                quantity: 3,
                // No saved cost at all: COGS excludes these units, so Gross
                // Profit has no admissible figure — but the shipping cost IS
                // recorded, so the reason must name the COGS gap only.
                costSnapshot: null,
                costType: 'actual',
                isManual: false,
                manualName: null,
                addonAmount: 0,
                addonCostAmount: 0,
              },
            ],
            payments: [],
            refunds: [],
            returns: [],
            dispatches: [],
          },
        ];
      }
      return [];
    });
    const res = await service.getPnl({} as any);
    expect(res.data.lines.cogs.state).toBe('unavailable');
    expect(res.data.lines.grossProfit).toMatchObject({ value: 300, state: 'unavailable' });
    expect(res.data.lines.grossProfit.reason).toBe(
      'cost missing on 3 unit(s) in 1 line(s)',
    );
    expect(res.data.lines.grossProfit.reason).not.toContain('shipping');
  });

  it('all-actual ladder: costNotSet is zero and profit lines are ok', async () => {
    mockPrisma.order.findMany.mockImplementation(async (args: any) => {
      if (args.select?.timeline) {
        return [
          {
            id: 'o-actual',
            total: 550,
            subtotal: 550,
            shippingCharge: 0,
            discount: 0,
            discountType: 'flat',
            status: { name: 'Delivered' },
            timeline: [
              { status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' },
            ],
            createdAt: new Date('2026-09-10T00:00:00+06:00'),
            paymentOptionType: 'FULL_PAYMENT',
            customerId: null,
            customerPhone: null,
            guestPhone: null,
            shippingCost: 60,
            shippingCostSource: 'manual',
            items: [
              {
                productId: 'p1',
                variantId: null,
                price: 500,
                quantity: 1,
                costSnapshot: 300,
                costType: 'actual',
                isManual: false,
                manualName: null,
                addonAmount: 0,
                addonCostAmount: 0,
              },
            ],
            payments: [],
            refunds: [],
            returns: [],
            dispatches: [],
          },
        ];
      }
      return [];
    });
    const res = await service.getPnl({} as any);
    expect(res.data.costNotSet).toEqual({ units: 0, amount: 0, lines: 0 });
    expect(res.data.lines.grossProfit).toMatchObject({
      value: 200,
      state: 'ok',
    });
    expect(res.meta.ladderState).toBe('actual');
  });
});
