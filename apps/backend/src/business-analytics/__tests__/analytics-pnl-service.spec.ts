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
});
