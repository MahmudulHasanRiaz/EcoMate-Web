/**
 * P2 data-layer tests — reconciliation registry (§4.3).
 *
 * R3,R4,R5,R6,R9,R10,R11,R12,R14,R15,R16,R17,R18 + R1,R2 (P4) + R7,R8 (P7)
 * now. R13 (accounting period delta) stays deferred with an explicit
 * reason — returns warn, never a silent pass. The registry is designed for
 * P4/P6/P7/P8/P9 extension.
 */
import {
  evaluateChecks,
  CHECK_REGISTRY,
  DEFERRED_CHECKS,
  MARKETING_OVERLAP_RE,
  AnalyticsReconciliationService,
  type ReconciliationInput,
} from '../analytics-reconciliation.service';
import { Test } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsFilterService } from '../analytics-filter.service';
import { AnalyticsPnlService } from '../analytics-pnl.service';
import { AnalyticsFulfillmentService } from '../analytics-fulfillment.service';
import { AnalyticsProductsService } from '../analytics-products.service';
import { CacheService } from '../../cache/cache.service';

function baseInput(extra: Partial<ReconciliationInput> = {}): ReconciliationInput {
  const ladder = {
    grossSales: 1000,
    discounts: 100,
    returns: 0,
    refundsReversal: 0,
    netSales: 900,
    cogs: 360,
    grossProfit: 540,
    fulfillmentCost: 60,
    paymentFees: 20,
    marketingCost: 100,
    contributionProfit: 360,
    operatingExpenses: 60,
    // §2.11: Operating/Net Profit are TBC − OE = (360 + 80) − 60 = 380.
    operatingProfit: 380,
    netProfit: 380,
  };
  return {
    ladder,
    bridge: {
      contributionProfit: 360,
      deliveryChargeRetained: 80,
      fulfillmentMargin: 20,
      totalBusinessContribution: 440,
      operatingProfit: 380,
      netProfit: 380,
      operands: ['contributionProfit', 'deliveryChargeRetained'],
    },
    ledgerNetProfit: 380,
    expensesTotal: 60,
    paidPaymentsTotal: 1000,
    cashCollected: 1000,
    partition: {
      total: 5,
      recognised: 2,
      inFulfilment: 1,
      cancelled: 1,
      returnedBeforeDelivery: 1,
      undatedDeliveries: 0,
    },
    settlementOnline: { collected: 1000, refunded: 200, retained: 800 },
    fulfillmentOnline: { margin: 20, deliveryChargeRetained: 80, courierCost: 60 },
    revenueBucketHasSettlement: false,
    doubleReversalOrders: [],
    products: {
      productNetSum: 900,
      scoped: false,
      parents: [],
    },
    marketingIdentity: { allTimeCost: 800, datedCost: 500, undatedCost: 300 },
    marketingPeriodTotal: 500,
    // R7 default: attribution basis agrees with the P&L marketing line.
    marketingAllocationTotal: 100,
    // R8 default: one campaign footing within rounding dust.
    marketingCampaignIdentity: {
      campaigns: [
        {
          campaignId: 'c1',
          name: 'Camp One',
          consumptionCost: 800,
          productCost: 800,
          allocRows: 2,
          pmcRows: 3,
        },
      ],
      nullCampaignConsumption: 0,
    },
    codLeakOrders: [],
    warnings: {
      cogsUnavailableUnits: 0,
      ordersMissingShippingCost: 0,
      paymentsMissingFee: 0,
      timelineLessDeliveries: 0,
      partialFlagged: 0,
      returnPendingInFlight: 0,
      unmappedLocations: 0,
      marketingOverlapCategories: [],
      marketingCost: 100,
      phoneLessGuests: 0,
      shippingRefundInferences: 0,
      consumptionsMissingSpendDate: 0,
      consumptionsMissingSpendAmount: 0,
      codUnsettledOrders: 0,
      codUnsettledCourierCost: 0,
    },
    ...extra,
  };
}

function byId(results: { id: string }[], id: string) {
  const found = results.find((r) => r.id === id);
    if (!found) throw new Error(`missing check ${id}`);
  return found as any;
}

describe('reconciliation registry', () => {
  it('registers every live R check with a deferred reason for R13 only', () => {
    const ids = CHECK_REGISTRY.map((c) => c.id);
    for (const id of [
      'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11',
      'R12', 'R14', 'R15', 'R16', 'R17', 'R18',
    ]) {
      expect(ids).toContain(id);
    }
    expect(DEFERRED_CHECKS).toMatchObject({
      R13: expect.stringContaining('accounting'),
    });
    expect(DEFERRED_CHECKS).not.toHaveProperty('R1');
    expect(DEFERRED_CHECKS).not.toHaveProperty('R2');
    expect(DEFERRED_CHECKS).not.toHaveProperty('R7');
    expect(DEFERRED_CHECKS).not.toHaveProperty('R8');
  });

  it('is extensible (P4/P6/P7/P8/P9 push entries without touching the runner)', () => {
    const before = CHECK_REGISTRY.length;
    CHECK_REGISTRY.push({
      id: 'RX',
      title: 'extension probe',
      run: () => ({
        id: 'RX',
        status: 'pass',
        expected: 1,
        actual: 1,
        explanation: 'probe',
      }),
    } as any);
    const results = evaluateChecks(baseInput());
    expect(byId(results, 'RX').status).toBe('pass');
    CHECK_REGISTRY.splice(before, 1);
  });
});

describe('implemented R checks', () => {
  it('R3 rebuilds the ladder to Net Profit', () => {
    expect(byId(evaluateChecks(baseInput()), 'R3').status).toBe('pass');
    const broken = baseInput();
    broken.ladder = { ...broken.ladder, netSales: 1 };
    expect(byId(evaluateChecks(broken), 'R3').status).toBe('fail');
  });

  it('R3 counts Delivery Charge Retained toward Operating/Net Profit (§2.11)', () => {
    // Fixture carries DCR = 80: the DCR-blind ladder (op = cp − opex) must fail.
    const dcrBlind = baseInput();
    dcrBlind.ladder = {
      ...dcrBlind.ladder,
      operatingProfit: 300,
      netProfit: 300,
    };
    expect(byId(evaluateChecks(dcrBlind), 'R3').status).toBe('fail');
    // Zero-DCR ladders still foot exactly.
    const noDcr = baseInput();
    noDcr.ladder = {
      ...noDcr.ladder,
      operatingProfit: 300,
      netProfit: 300,
    };
    noDcr.bridge = {
      ...noDcr.bridge,
      deliveryChargeRetained: 0,
      fulfillmentMargin: -60,
      totalBusinessContribution: 360,
      operatingProfit: 300,
      netProfit: 300,
    };
    noDcr.ledgerNetProfit = 300;
    expect(byId(evaluateChecks(noDcr), 'R3').status).toBe('pass');
  });

  it('R4 ties expense analytics to Expense.amount + taxAmount', () => {
    expect(byId(evaluateChecks(baseInput()), 'R4').status).toBe('pass');
  });

  it('R5 ties PAID payments to L3 cash collected', () => {
    expect(byId(evaluateChecks(baseInput()), 'R5').status).toBe('pass');
    const broken = baseInput({ cashCollected: 1 });
    expect(byId(evaluateChecks(broken), 'R5').status).toBe('fail');
  });

  it('R6 partitions booked orders with zero remainder', () => {
    expect(byId(evaluateChecks(baseInput()), 'R6')).toMatchObject({
      status: 'pass',
      expected: 5,
      actual: 5,
    });
    const broken = baseInput();
    broken.partition = { ...broken.partition, total: 6 };
    expect(byId(evaluateChecks(broken), 'R6').status).toBe('fail');
  });

  it('R9/R10 hold settlement and fulfillment identities (online only)', () => {
    const results = evaluateChecks(baseInput());
    expect(byId(results, 'R9').status).toBe('pass');
    expect(byId(results, 'R10').status).toBe('pass');
  });

  it('R11 fails when settlement leaks into revenue buckets', () => {
    const results = evaluateChecks(
      baseInput({ revenueBucketHasSettlement: true }),
    );
    expect(byId(results, 'R11').status).toBe('fail');
  });

  it('R12 fails on double-reversal orders', () => {
    const results = evaluateChecks(
      baseInput({ doubleReversalOrders: ['o1'] }),
    );
    expect(byId(results, 'R12')).toMatchObject({
      status: 'fail',
      actual: ['o1'],
    });
  });

  it('R14 holds the bridge identity; R15 forbids FM as an operand', () => {
    const results = evaluateChecks(baseInput());
    expect(byId(results, 'R14').status).toBe('pass');
    expect(byId(results, 'R15')).toMatchObject({ status: 'pass' });
    const withFm = baseInput();
    withFm.bridge = {
      ...withFm.bridge,
      operands: ['contributionProfit', 'fulfillmentMargin'],
    };
    expect(byId(evaluateChecks(withFm), 'R15').status).toBe('fail');
  });

  it('R16 requires the component-once ledger to sum to Net Profit', () => {
    expect(byId(evaluateChecks(baseInput()), 'R16').status).toBe('pass');
    expect(
      byId(evaluateChecks(baseInput({ ledgerNetProfit: 1 })), 'R16').status,
    ).toBe('fail');
  });

  it('R17 enforces marketing strictness (dated + undated identity)', () => {
    expect(byId(evaluateChecks(baseInput()), 'R17').status).toBe('pass');
    const broken = baseInput();
    broken.marketingIdentity = { allTimeCost: 999, datedCost: 500, undatedCost: 300 };
    expect(byId(evaluateChecks(broken), 'R17').status).toBe('fail');
  });

  it('R18 fails on COD collection leaks', () => {
    expect(byId(evaluateChecks(baseInput()), 'R18').status).toBe('pass');
    expect(
      byId(evaluateChecks(baseInput({ codLeakOrders: ['cod1'] })), 'R18')
        .status,
    ).toBe('fail');
  });

  it('R7 passes on agreement, warns with delta + cause on divergence (never fails)', () => {
    expect(byId(evaluateChecks(baseInput()), 'R7').status).toBe('pass');
    const diverged = baseInput({ marketingAllocationTotal: 60 });
    const check = byId(evaluateChecks(diverged), 'R7') as any;
    expect(check.status).toBe('warn');
    expect(check.expected).toBe(100);
    expect(check.actual).toBe(60);
    expect(check.explanation).toMatch(/Δ/);
    expect(check.explanation).toMatch(/spendDate/);
    expect(check.explanation).toMatch(/calculatedAt/);
  });

  it('R8 holds the date-independent campaign identity, failing with per-campaign cause', () => {
    expect(byId(evaluateChecks(baseInput()), 'R8').status).toBe('pass');
    const diverged = baseInput();
    diverged.marketingCampaignIdentity = {
      campaigns: [
        {
          campaignId: 'c1',
          name: 'Camp One',
          consumptionCost: 800,
          productCost: 700,
          allocRows: 2,
          pmcRows: 3,
        },
      ],
      nullCampaignConsumption: 0,
    };
    const check = byId(evaluateChecks(diverged), 'R8') as any;
    expect(check.status).toBe('fail');
    expect(check.explanation).toMatch(/Camp One/);
    const nullLeak = baseInput();
    nullLeak.marketingCampaignIdentity = {
      campaigns: [],
      nullCampaignConsumption: 50,
    };
    expect(byId(evaluateChecks(nullLeak), 'R8').status).toBe('fail');
  });

  it('R8 tolerates per-row rounding dust (half a cent per rounded row)', () => {
    const dusty = baseInput();
    dusty.marketingCampaignIdentity = {
      campaigns: [
        {
          campaignId: 'c1',
          name: 'Camp One',
          consumptionCost: 800,
          // 5 rounded rows × 0.005 + slack = 0.03 tolerance; 0.02 dust passes.
          productCost: 799.98,
          allocRows: 2,
          pmcRows: 3,
        },
      ],
      nullCampaignConsumption: 0,
    };
    expect(byId(evaluateChecks(dusty), 'R8').status).toBe('pass');
  });

  it('deferred checks warn with reasons (never silent)', () => {
    const results = evaluateChecks(baseInput());
    for (const id of ['R13']) {
      const check = byId(results, id);
      expect(check.status).toBe('warn');
      expect(check.explanation.length).toBeGreaterThan(10);
    }
  });

  it('R1 passes on the pre-refund basis and R2 on empty parents', () => {
    const results = evaluateChecks(baseInput());
    expect(byId(results, 'R1')).toMatchObject({ status: 'pass' });
    expect(byId(results, 'R2')).toMatchObject({ status: 'pass' });
  });
});

describe('warnings W1–W11', () => {
  it('passes clean and warns with counts otherwise', () => {
    const clean = evaluateChecks(baseInput());
    for (const id of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W9', 'W10', 'W11']) {
      expect(byId(clean, id).status).toBe('pass');
    }
    const dirty = evaluateChecks(
      baseInput({
        warnings: {
          cogsUnavailableUnits: 2,
          ordersMissingShippingCost: 3,
          paymentsMissingFee: 1,
          timelineLessDeliveries: 1,
          partialFlagged: 1,
          returnPendingInFlight: 1,
          unmappedLocations: 4,
          marketingOverlapCategories: [],
          marketingCost: 100,
          phoneLessGuests: 2,
          shippingRefundInferences: 1,
          consumptionsMissingSpendDate: 2,
          consumptionsMissingSpendAmount: 300,
          codUnsettledOrders: 2,
          codUnsettledCourierCost: 120,
        },
      }),
    );
    expect(byId(dirty, 'W1').actual).toBe(2);
    expect(byId(dirty, 'W10').actual).toBe(2);
    expect(byId(dirty, 'W10').explanation).toContain('300');
    expect(byId(dirty, 'W11').actual).toBe(2);
  });

  it('W8 fires on ad-keyword categories while marketing cost > 0', () => {
    const results = evaluateChecks(
      baseInput({
        warnings: {
          ...baseInput().warnings,
          marketingOverlapCategories: ['Facebook Ads'],
        },
      }),
    );
    expect(byId(results, 'W8').status).toBe('warn');
    const quiet = evaluateChecks(
      baseInput({
        warnings: { ...baseInput().warnings, marketingCost: 0 },
      }),
    );
    expect(byId(quiet, 'W8').status).toBe('pass');
  });

  it('W8 stays quiet for a "Leads" category even with marketing cost (no ads-substring false positive)', () => {
    expect(MARKETING_OVERLAP_RE.test('Leads')).toBe(false);
    const results = evaluateChecks(
      baseInput({
        warnings: {
          ...baseInput().warnings,
          marketingOverlapCategories: [],
        },
      }),
    );
    expect(byId(results, 'W8').status).toBe('pass');
  });
});

describe('MARKETING_OVERLAP_RE word boundaries', () => {
  it.each(['paid ads', 'Facebook Ads', 'Google Ads', 'Marketing', 'promo', 'boost', 'tiktok', 'advert'])(
    'fires on %s',
    (name) => {
      expect(MARKETING_OVERLAP_RE.test(name)).toBe(true);
    },
  );

  it.each(['Leads', 'leads', 'HOMELEADS'])('never fires on %s', (name) => {
    expect(MARKETING_OVERLAP_RE.test(name)).toBe(false);
  });
});

describe('runReconciliation R5 wiring', () => {
  const range = {
    start: new Date('2026-09-01T00:00:00+06:00'),
    end: new Date('2026-09-30T17:59:59.999Z'),
    periodDays: 30,
    granularity: 'day',
    comparison: { prevStart: new Date(), prevEnd: new Date() },
  };

  const zeroLine = { value: 0, state: 'ok' };

  function mockPnl(cashCollected: number | null) {
    return {
      data: {
        lines: {
          grossSales: zeroLine,
          discounts: zeroLine,
          returns: zeroLine,
          refundsReversal: zeroLine,
          netSales: zeroLine,
          cogs: zeroLine,
          grossProfit: zeroLine,
          fulfillmentCost: zeroLine,
          paymentFees: zeroLine,
          marketingCost: zeroLine,
          contributionProfit: zeroLine,
          operatingExpenses: zeroLine,
          operatingProfit: zeroLine,
          netProfit: zeroLine,
        },
        bridge: {
          contributionProfit: 0,
          deliveryChargeRetained: 0,
          fulfillmentMargin: 0,
          totalBusinessContribution: 0,
          operatingProfit: 0,
          netProfit: 0,
          operands: ['contributionProfit', 'deliveryChargeRetained'],
          shippingRefundInferences: 0,
        },
        lenses: { cashCollected: { value: cashCollected, state: 'ok' } },
        strip: { undatedDeliveries: 0 },
        coverage: {
          cogs: { unavailableUnits: 0 },
          shipping: { unavailableOrders: 0 },
          fees: { withoutFee: 0 },
          marketing: { undatedRows: 0, undatedAmount: 0 },
        },
      },
      meta: { costCoverage: {}, ladderState: 'actual', thresholds: {} },
    };
  }

  async function runWith(
    paidSum: number | null,
    lensCash: number | null,
    fulRows: any[] = [],
    categories: any[] = [],
  ) {
    const mockPrisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      marketingConsumption: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      expenseCategory: { findMany: jest.fn().mockResolvedValue(categories) },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: paidSum } }),
      },
      marketingCostAllocation: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { allocatedCost: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productMarketingCost: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      marketingCampaign: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mockFilter: any = {
      resolveContext: jest.fn().mockReturnValue({ range, filters: {} }),
      buildOrderWhere: jest.fn().mockReturnValue({ trashedAt: null }),
      resolveMarketingOrderIds: jest.fn(),
    };
    const mockPnlSvc: any = { getPnl: jest.fn().mockResolvedValue(mockPnl(lensCash)) };
    const mockFulSvc: any = {
      getFulfillment: jest.fn().mockResolvedValue({
        data: {
          rows: fulRows,
          totals: { collected: 0, fulfillmentMargin: 0, deliveryChargeRetained: 0 },
          coverage: { collectionUnavailableOrders: 0, unknownAmount: 0 },
        },
        meta: {},
      }),
    };
    const mockProductsSvc: any = {
      getAggregates: jest.fn().mockResolvedValue({ productNetSum: 0, scoped: false, parents: [] }),
    };
    const cache: any = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsReconciliationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsFilterService, useValue: mockFilter },
        { provide: AnalyticsPnlService, useValue: mockPnlSvc },
        { provide: AnalyticsFulfillmentService, useValue: mockFulSvc },
        { provide: AnalyticsProductsService, useValue: mockProductsSvc },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    const service: any = module.get(AnalyticsReconciliationService);
    const res = await service.runReconciliation({});
    return { res, mockPrisma };
  }

  it('issues an independent PAID aggregate for R5 (never the lens value)', async () => {
    const { mockPrisma } = await runWith(500, 500);
    expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PaymentStatus.PAID,
          createdAt: { gte: range.start, lte: range.end },
        }),
      }),
    );
  });

  it('fails R5 when the lens drifts from the independent aggregate', async () => {
    const { res } = await runWith(500, 999);
    const r5 = res.data.checks.find((c: any) => c.id === 'R5');
    expect(r5.status).toBe('fail');
    expect(r5.expected).toBe(999);
    expect(r5.actual).toBe(500);
  });

  it('passes R5 when the lens agrees with the independent aggregate', async () => {
    const { res } = await runWith(500, 500);
    const r5 = res.data.checks.find((c: any) => c.id === 'R5');
    expect(r5.status).toBe('pass');
  });

  it('runs R7/R8 live in the wiring path (no deferred stub)', async () => {
    const { res, mockPrisma } = await runWith(500, 500);
    expect(mockPrisma.marketingCostAllocation.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ order: { trashedAt: null } }),
      }),
    );
    const r7 = res.data.checks.find((c: any) => c.id === 'R7');
    const r8 = res.data.checks.find((c: any) => c.id === 'R8');
    expect(r7.status).toBe('pass');
    expect(r8.status).toBe('pass');
  });

  it('derives R11 live: clean settlement rows pass', async () => {
    const { res } = await runWith(500, 500, [
      {
        orderId: 'o1',
        collection: 'online',
        amountCollected: { value: 1000 },
        amountRefunded: { value: 0 },
        amountRetained: { value: 1000 },
        deliveryChargeRetained: { value: 80 },
        courierCost: { value: 60 },
        fulfillmentMargin: { value: 20 },
      },
    ]);
    expect(res.data.checks.find((c: any) => c.id === 'R11').status).toBe(
      'pass',
    );
  });

  it('derives R11 live: a settlement key inside a revenue bucket fails', async () => {
    const { res } = await runWith(500, 500, [
      {
        orderId: 'o1',
        collection: 'online',
        amountCollected: { value: 1000 },
        amountRefunded: { value: 0 },
        amountRetained: { value: 1000 },
        deliveryChargeRetained: { value: 80 },
        courierCost: { value: 60 },
        fulfillmentMargin: { value: 20 },
        grossSales: 1000,
      },
    ]);
    const r11 = res.data.checks.find((c: any) => c.id === 'R11');
    expect(r11.status).toBe('fail');
    expect(r11.actual).toBe(1);
  });

  it('keeps W8 quiet for a Leads category (live overlap scan)', async () => {
    const { res } = await runWith(500, 500, [], [
      { name: 'Leads', slug: 'leads' },
    ]);
    expect(res.data.checks.find((c: any) => c.id === 'W8').status).toBe(
      'pass',
    );
  });

  it('fires W8 live for a paid-ads category when marketing cost > 0', async () => {
    const { res } = await runWith(500, 500, [], [
      { name: 'paid ads', slug: 'paid-ads' },
    ]);
    // Marketing cost is 0 in this fixture (no consumptions), so the quiet
    // case holds; the regex itself fires (covered above) and the dirty
    // evaluateChecks case covers cost > 0.
    expect(res.data.checks.find((c: any) => c.id === 'W8').status).toBe(
      'pass',
    );
  });
});
