/**
 * P1 pure-rule tests — metric & financial contract (§7.1 P1 items).
 *
 * Covers: 13/14-status Delivered gate, revenue event dating + dispatch
 * fallback + undatedDeliveries, return-before-delivery, delivered-then-returned
 * cross-period, Partial flag, return/refund crossover (D7), discount
 * allocation, spendDate-null strictness (D10, no allocatedAt path, R17),
 * TBC bridge + forbidden FM add (D12), margins with Net Sales <= 0,
 * movement thresholds, shipping-refund inference, COD honesty (D11).
 */
import {
  ORDER_STATUSES,
  STATUS_META,
  isFinalStatus,
  recognitionGroup,
  resolveConditionalRecognition,
  isRevenueRecognised,
  findDeliveredTransition,
  findReturnTransition,
  resolveRevenueEvent,
  resolveReturn,
  classifyRefund,
  classifyRefunds,
  hasDoubleReversal,
  allocateDiscount,
  cogsLineState,
  fulfillmentCostState,
  paymentFeeState,
  OTHER_COSTS_STATE,
  COGS_COST_TYPES,
  FULFILLMENT_COST_SOURCES,
  NO_COURIER_SETTLEMENT_SOURCE,
  marketingPeriodCost,
  marketingIdentityTotals,
  MOVEMENT_FAST_DOI_MAX,
  MOVEMENT_SLOW_DOI_MIN,
  MOVEMENT_RATIONALE,
  computeDOI,
  classifyMovement,
  inferDeliveryChargeRetained,
  COD_SETTLEMENT,
  computeContributionProfit,
  computeFulfillmentMargin,
  computeTotalBusinessContribution,
  computeNetProfit,
  computeOperatingProfit,
  computeNetProfitFromLedger,
  computeMargin,
  type TimelineEntry,
  type MarketingConsumptionRow,
} from '../metric-contract';

const D = (iso: string): Date => new Date(iso);
const entry = (status: string, timestamp: string): TimelineEntry => ({
  status,
  timestamp,
});

describe('lifecycle vocabulary (§1.3)', () => {
  it('covers every status in the order transition map', () => {
    expect(ORDER_STATUSES).toStrictEqual([
      'Pending',
      'Payment Pending',
      'Payment Verifying',
      'Hold',
      'Confirmed',
      'Packed',
      'Packing Hold',
      'Shipping',
      'Delivered',
      'Partial',
      'Return Pending',
      'Returned',
      'Damaged',
      'Cancelled',
    ]);
    expect(ORDER_STATUSES).toHaveLength(14);
    for (const s of ORDER_STATUSES) {
      expect(STATUS_META[s]).toBeDefined();
    }
  });

  it('STATUS_META is frozen', () => {
    expect(Object.isFrozen(STATUS_META)).toBe(true);
  });

  it('STATUS_META entries are deep-frozen (nested mutation throws)', () => {
    for (const s of ORDER_STATUSES) {
      expect(Object.isFrozen(STATUS_META[s])).toBe(true);
    }
    expect(() => {
      (STATUS_META.Pending as { group: string }).group = 'recognised';
    }).toThrow();
    expect(STATUS_META.Pending.group).toBe('pre_fulfilment');
  });

  it.each([
    ['Pending', false],
    ['Payment Pending', false],
    ['Payment Verifying', false],
    ['Hold', false],
    ['Confirmed', false],
    ['Packed', false],
    ['Packing Hold', false],
    ['Shipping', false],
    ['Delivered', true],
    ['Partial', false],
    ['Return Pending', false],
    ['Returned', true],
    ['Damaged', true],
    ['Cancelled', true],
  ])('isFinalStatus(%s) === %s', (status, expected) => {
    expect(isFinalStatus(status)).toBe(expected);
  });

  it.each([['Bogus'], [''], ['delivered']])(
    'unknown status %s throws across the strict contract',
    (status) => {
      expect(() => isFinalStatus(status)).toThrow(
        `Unknown order status: ${status}`,
      );
      expect(() => recognitionGroup(status)).toThrow(
        `Unknown order status: ${status}`,
      );
      expect(() => isRevenueRecognised(status)).toThrow(
        `Unknown order status: ${status}`,
      );
    },
  );

  it.each([
    ['Pending', 'pre_fulfilment'],
    ['Payment Pending', 'pre_fulfilment'],
    ['Payment Verifying', 'pre_fulfilment'],
    ['Hold', 'pre_fulfilment'],
    ['Confirmed', 'in_fulfilment'],
    ['Packed', 'in_fulfilment'],
    ['Packing Hold', 'in_fulfilment'],
    ['Shipping', 'in_fulfilment'],
    ['Delivered', 'recognised'],
    ['Partial', 'unrecognised_flagged'],
    ['Return Pending', 'conditional'],
    ['Returned', 'conditional'],
    ['Damaged', 'conditional'],
    ['Cancelled', 'never'],
  ])('recognitionGroup(%s) === %s', (status, expected) => {
    expect(recognitionGroup(status)).toBe(expected);
  });

  it('Return Pending without prior delivery is unrecognised; with prior delivery is recognised', () => {
    expect(resolveConditionalRecognition('Return Pending', false)).toBe(
      'unrecognised',
    );
    expect(resolveConditionalRecognition('Return Pending', true)).toBe(
      'recognised',
    );
  });

  it('Returned/Damaged reverse only with a prior delivery', () => {
    expect(resolveConditionalRecognition('Returned', false)).toBe(
      'unrecognised',
    );
    expect(resolveConditionalRecognition('Returned', true)).toBe('reversed');
    expect(resolveConditionalRecognition('Damaged', false)).toBe(
      'unrecognised',
    );
    expect(resolveConditionalRecognition('Damaged', true)).toBe('reversed');
  });

  it('Cancelled is never recognised, even with a prior delivery', () => {
    expect(isRevenueRecognised('Cancelled', true)).toBe(false);
    expect(isRevenueRecognised('Cancelled', false)).toBe(false);
  });

  it('Partial is unrecognised and flagged, regardless of history', () => {
    expect(isRevenueRecognised('Partial', true)).toBe(false);
    expect(recognitionGroup('Partial')).toBe('unrecognised_flagged');
  });
});

describe('Delivered gate (D4)', () => {
  it.each(['Pending', 'Confirmed', 'Shipping'])(
    '%s contributes zero to Net Sales',
    (status) => {
      expect(isRevenueRecognised(status, false)).toBe(false);
    },
  );

  it('Delivered is recognised', () => {
    expect(isRevenueRecognised('Delivered', false)).toBe(true);
  });

  it('Delivered transition date wins over the dispatch fallback', () => {
    const timeline = [
      entry('Pending', '2026-08-01T10:00:00Z'),
      entry('Delivered', '2026-08-05T12:00:00Z'),
    ];
    const evt = resolveRevenueEvent({
      timeline,
      dispatchDeliveredAt: D('2026-08-06T09:00:00Z'),
      currentStatus: 'Delivered',
    });
    expect(evt.recognised).toBe(true);
    expect(evt.revenueDate?.toISOString()).toBe('2026-08-05T12:00:00.000Z');
    expect(evt.revenueDateSource).toBe('timeline');
    expect(evt.undatedDelivery).toBe(false);
  });

  it('timeline-less delivery falls back to Dispatch.deliveredAt', () => {
    const evt = resolveRevenueEvent({
      timeline: [],
      dispatchDeliveredAt: D('2026-08-06T09:00:00Z'),
      currentStatus: 'Delivered',
    });
    expect(evt.recognised).toBe(true);
    expect(evt.revenueDate?.toISOString()).toBe('2026-08-06T09:00:00.000Z');
    expect(evt.revenueDateSource).toBe('dispatch');
    expect(evt.undatedDelivery).toBe(false);
  });

  it('delivery with neither timeline nor dispatch date is undated, never guessed', () => {
    const evt = resolveRevenueEvent({ timeline: [], currentStatus: 'Delivered' });
    expect(evt.recognised).toBe(false);
    expect(evt.revenueDate).toBeNull();
    expect(evt.revenueDateSource).toBeNull();
    expect(evt.undatedDelivery).toBe(true);
  });

  it('non-delivery statuses are never counted as undatedDeliveries', () => {
    const evt = resolveRevenueEvent({ timeline: [], currentStatus: 'Pending' });
    expect(evt.recognised).toBe(false);
    expect(evt.undatedDelivery).toBe(false);
  });

  it('garbage timeline timestamp never yields recognised:true with Invalid Date', () => {
    const evt = resolveRevenueEvent({
      timeline: [entry('Delivered', 'not-a-date')],
      currentStatus: 'Delivered',
    });
    expect(evt.recognised).toBe(false);
    expect(evt.revenueDate).toBeNull();
    expect(evt.revenueDateSource).toBeNull();
    expect(evt.undatedDelivery).toBe(true);
  });

  it('garbage timeline timestamp falls back to a valid dispatch date', () => {
    const evt = resolveRevenueEvent({
      timeline: [entry('Delivered', 'garbage')],
      dispatchDeliveredAt: D('2026-08-06T09:00:00Z'),
      currentStatus: 'Delivered',
    });
    expect(evt.recognised).toBe(true);
    expect(evt.revenueDate?.toISOString()).toBe('2026-08-06T09:00:00.000Z');
    expect(evt.revenueDateSource).toBe('dispatch');
  });

  it('garbage dispatch date coerces to null (undated, never guessed)', () => {
    const evt = resolveRevenueEvent({
      timeline: [],
      dispatchDeliveredAt: 'garbage',
      currentStatus: 'Delivered',
    });
    expect(evt.recognised).toBe(false);
    expect(evt.revenueDate).toBeNull();
    expect(evt.revenueDateSource).toBeNull();
    expect(evt.undatedDelivery).toBe(true);
  });

  it('findDeliveredTransition returns the Delivered timestamp', () => {
    const timeline = [
      entry('Pending', '2026-08-01T10:00:00Z'),
      entry('Delivered', '2026-08-05T12:00:00Z'),
      entry('Return Pending', '2026-08-07T12:00:00Z'),
    ];
    expect(findDeliveredTransition(timeline)?.timestamp).toBe(
      '2026-08-05T12:00:00Z',
    );
    expect(findDeliveredTransition([entry('Pending', '2026-08-01T10:00:00Z')])).toBeNull();
  });

  it('findDeliveredTransition is latest-wins; ties break to the later entry', () => {
    const timeline = [
      entry('Delivered', '2026-08-05T12:00:00Z'),
      entry('Delivered', '2026-08-09T12:00:00Z'),
    ];
    expect(findDeliveredTransition(timeline)?.timestamp).toBe(
      '2026-08-09T12:00:00Z',
    );
    const tied = [
      entry('Delivered', '2026-08-05T12:00:00Z'),
      entry('Shipping', '2026-08-06T12:00:00Z'),
      entry('Delivered', '2026-08-05T12:00:00Z'),
    ];
    expect(findDeliveredTransition(tied)).toBe(tied[2]);
    expect(findDeliveredTransition([entry('Delivered', 'garbage')])).toBeNull();
  });

  it('findReturnTransition matches the latest Returned or Damaged; Return Pending never matches', () => {
    expect(
      findReturnTransition([entry('Damaged', '2026-08-09T00:00:00Z')])?.timestamp,
    ).toBe('2026-08-09T00:00:00Z');
    expect(
      findReturnTransition([entry('Returned', '2026-08-03T00:00:00Z')])?.status,
    ).toBe('Returned');
    expect(
      findReturnTransition([entry('Return Pending', '2026-08-07T00:00:00Z')]),
    ).toBeNull();
    expect(
      findReturnTransition([entry('Delivered', '2026-08-05T00:00:00Z')]),
    ).toBeNull();
    const both = [
      entry('Returned', '2026-08-03T00:00:00Z'),
      entry('Damaged', '2026-08-09T00:00:00Z'),
    ];
    expect(findReturnTransition(both)?.timestamp).toBe('2026-08-09T00:00:00Z');
  });
});

describe('returns (F9, §2.2)', () => {
  it('return before delivery produces no reversal', () => {
    const timeline = [
      entry('Shipping', '2026-08-01T10:00:00Z'),
      entry('Return Pending', '2026-08-02T10:00:00Z'),
      entry('Returned', '2026-08-03T10:00:00Z'),
    ];
    const res = resolveReturn(timeline, null);
    expect(res.hasReturn).toBe(true);
    expect(res.returnAt?.toISOString()).toBe('2026-08-03T10:00:00.000Z');
    expect(res.reversesRevenue).toBe(false);
  });

  it('delivered-then-returned recognises at delivery and reverses at return', () => {
    const deliveredAt = D('2026-08-05T12:00:00Z');
    const timeline = [
      entry('Delivered', '2026-08-05T12:00:00Z'),
      entry('Return Pending', '2026-08-07T12:00:00Z'),
      entry('Returned', '2026-09-02T12:00:00Z'),
    ];
    const res = resolveReturn(timeline, deliveredAt);
    expect(res.hasReturn).toBe(true);
    expect(res.reversesRevenue).toBe(true);
    // Cross-period: delivered in P1 (Aug), reversed in P2 (Sep) — P1 untouched.
    const inAug = (d: Date | null) =>
      d !== null && d >= D('2026-08-01T00:00:00Z') && d < D('2026-09-01T00:00:00Z');
    const inSep = (d: Date | null) =>
      d !== null && d >= D('2026-09-01T00:00:00Z') && d < D('2026-10-01T00:00:00Z');
    expect(inAug(deliveredAt)).toBe(true);
    expect(inAug(res.returnAt)).toBe(false);
    expect(inSep(res.returnAt)).toBe(true);
  });

  it('return dated before the delivery date does not reverse', () => {
    const res = resolveReturn(
      [entry('Returned', '2026-08-01T00:00:00Z')],
      D('2026-08-05T00:00:00Z'),
    );
    expect(res.reversesRevenue).toBe(false);
  });

  it('no return transition means no return', () => {
    const res = resolveReturn(
      [entry('Delivered', '2026-08-05T00:00:00Z')],
      D('2026-08-05T00:00:00Z'),
    );
    expect(res.hasReturn).toBe(false);
    expect(res.returnAt).toBeNull();
    expect(res.reversesRevenue).toBe(false);
  });

  it('unparseable return timestamp is undated: claims the return, never reverses', () => {
    const res = resolveReturn(
      [entry('Returned', 'garbage')],
      D('2026-08-05T00:00:00Z'),
    );
    expect(res.hasReturn).toBe(true);
    expect(res.returnAt).toBeNull();
    expect(res.reversesRevenue).toBe(false);
  });

  it('undefined deliveredAt never reverses', () => {
    const res = resolveReturn(
      [entry('Returned', '2026-08-06T00:00:00Z')],
      undefined,
    );
    expect(res.hasReturn).toBe(true);
    expect(res.reversesRevenue).toBe(false);
  });
});

describe('return/refund crossover (D7)', () => {
  it('refund on delivered, non-returned order is a reversal', () => {
    expect(
      classifyRefund({ wasDelivered: true, wasReturned: false }),
    ).toBe('reversal');
  });

  it('refund on delivered+returned order is informational only', () => {
    expect(classifyRefund({ wasDelivered: true, wasReturned: true })).toBe(
      'informational',
    );
  });

  it('refund on never-delivered order is not a reversal', () => {
    expect(
      classifyRefund({ wasDelivered: false, wasReturned: false }),
    ).toBe('not_a_reversal');
  });

  it('returned-but-never-delivered is not a reversal (return without delivery)', () => {
    expect(classifyRefund({ wasDelivered: false, wasReturned: true })).toBe(
      'not_a_reversal',
    );
  });

  it('multiple and partial refunds each classify independently', () => {
    const refunds = [
      { id: 'r1', amount: 100, processedAt: '2026-08-06T00:00:00Z' },
      { id: 'r2', amount: 250, processedAt: '2026-08-07T00:00:00Z' },
      { id: 'r3', amount: 50, processedAt: '2026-08-08T00:00:00Z' },
    ];
    expect(
      classifyRefunds({ wasDelivered: true, wasReturned: false }, refunds),
    ).toEqual(['reversal', 'reversal', 'reversal']);
    expect(
      classifyRefunds({ wasDelivered: true, wasReturned: true }, refunds.slice(0, 2)),
    ).toEqual(['informational', 'informational']);
  });

  it('length-only contract: contents ignored, output length matches input length', () => {
    const orderCase = { wasDelivered: true, wasReturned: false };
    const a = classifyRefunds(orderCase, [{ amount: 1 }, { amount: 999 }]);
    const b = classifyRefunds(orderCase, [{ other: 'x' }, { other: 'y' }]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(classifyRefunds(orderCase, [])).toEqual([]);
  });

  it('double-reversal guard: no order in both Returns and Refunds (reversal)', () => {
    expect(
      hasDoubleReversal({ inReturns: true, treatment: 'reversal' }),
    ).toBe(true);
    expect(
      hasDoubleReversal({ inReturns: true, treatment: 'informational' }),
    ).toBe(false);
    expect(
      hasDoubleReversal({ inReturns: false, treatment: 'reversal' }),
    ).toBe(false);
  });
});

describe('discount allocation (§2 single definition)', () => {
  it('flat discount splits proportionally across lines', () => {
    const out = allocateDiscount([600, 400], 100);
    expect(out[0].allocated).toBeCloseTo(60, 10);
    expect(out[1].allocated).toBeCloseTo(40, 10);
    expect(out[0].net).toBeCloseTo(540, 10);
    expect(out[1].net).toBeCloseTo(360, 10);
  });

  it('multi-variant lines foot exactly to gross minus discount', () => {
    const out = allocateDiscount([100, 200, 300], 60);
    const allocatedSum = out.reduce((s, l) => s + l.allocated, 0);
    expect(allocatedSum).toBeCloseTo(60, 10);
    const netSum = out.reduce((s, l) => s + l.net, 0);
    expect(netSum).toBeCloseTo(540, 10);
  });

  it('allocation clamps to lineGross (discount larger than gross)', () => {
    const out = allocateDiscount([50, 50], 200);
    expect(out[0].allocated).toBeLessThanOrEqual(50);
    expect(out[1].allocated).toBeLessThanOrEqual(50);
    expect(out[0].net).toBeGreaterThanOrEqual(0);
    expect(out[1].net).toBeGreaterThanOrEqual(0);
  });

  it('overflow allocates full gross to every line (allocated sum == gross)', () => {
    const out = allocateDiscount([50, 50], 200);
    expect(out.map((l) => l.allocated)).toEqual([50, 50]);
    expect(out.reduce((s, l) => s + l.allocated, 0)).toBe(100);
    expect(out.every((l) => l.net === 0)).toBe(true);
  });

  it('third-cent splits foot exactly to the discount (largest-remainder)', () => {
    const out = allocateDiscount([1, 1, 1], 1);
    expect(out.map((l) => l.allocated)).toEqual([0.34, 0.33, 0.33]);
    expect(out.reduce((s, l) => s + l.allocated, 0)).toBe(1);
    expect(out.reduce((s, l) => s + l.net, 0)).toBe(2);
  });

  it('negative and non-finite grosses count as 0', () => {
    const out = allocateDiscount([100, -50, NaN], 30);
    expect(out.map((l) => l.allocated)).toEqual([30, 0, 0]);
    expect(out.reduce((s, l) => s + l.allocated, 0)).toBe(30);
  });

  it('zero gross lines receive zero allocation, never NaN', () => {
    const out = allocateDiscount([0, 0], 50);
    expect(out[0].allocated).toBe(0);
    expect(out[1].allocated).toBe(0);
    expect(out[0].net).toBe(0);
  });
});

describe('marketing spend-date strictness (D5, D10, R17)', () => {
  const rows = [
    { calculatedCost: 100, spendDate: D('2026-08-05T00:00:00Z') },
    { calculatedCost: 50, spendDate: D('2026-07-01T00:00:00Z') },
    { calculatedCost: 30, spendDate: null },
  ];

  it('spendDate NULL rows contribute nothing to any period total', () => {
    const res = marketingPeriodCost(rows, D('2026-08-01T00:00:00Z'), D('2026-08-31T23:59:59.999Z'));
    expect(res.total).toBe(100);
    expect(res.datedAmount).toBe(100);
    expect(res.datedRows).toBe(1);
  });

  it('any undated row drives the marketing line to unavailable with the amount disclosed', () => {
    const res = marketingPeriodCost(rows, D('2026-08-01T00:00:00Z'), D('2026-08-31T23:59:59.999Z'));
    expect(res.state).toBe('unavailable');
    expect(res.undatedRows).toBe(1);
    expect(res.undatedAmount).toBe(30);
  });

  it('fully dated rows are actual', () => {
    const res = marketingPeriodCost(rows.slice(0, 2), D('2026-01-01T00:00:00Z'), D('2026-12-31T23:59:59.999Z'));
    expect(res.state).toBe('actual');
    expect(res.total).toBe(150);
  });

  it('inverted period throws', () => {
    expect(() =>
      marketingPeriodCost(
        rows,
        D('2026-08-31T23:59:59.999Z'),
        D('2026-08-01T00:00:00Z'),
      ),
    ).toThrow(/precedes/);
  });

  it('invalid spendDate strings count as undated (counted, contribute 0)', () => {
    const res = marketingPeriodCost(
      [
        { calculatedCost: 100, spendDate: D('2026-08-05T00:00:00Z') },
        { calculatedCost: 30, spendDate: 'not-a-date' },
      ],
      D('2026-08-01T00:00:00Z'),
      D('2026-08-31T23:59:59.999Z'),
    );
    expect(res.total).toBe(100);
    expect(res.datedRows).toBe(1);
    expect(res.undatedRows).toBe(1);
    expect(res.undatedAmount).toBe(30);
    expect(res.state).toBe('unavailable');
  });

  it('R17 identity treats invalid spendDate as undated', () => {
    const id = marketingIdentityTotals([
      ...rows,
      { calculatedCost: 7, spendDate: 'garbage' },
    ]);
    expect(id.undatedCost).toBe(37);
    expect(id.allTimeCost).toBe(187);
    expect(id.datedCost + id.undatedCost).toBe(id.allTimeCost);
  });

  it('allocatedAt is never a financial date input (behavioral)', () => {
    const start = D('2026-08-01T00:00:00Z');
    const end = D('2026-08-31T23:59:59.999Z');
    const plain: MarketingConsumptionRow = {
      calculatedCost: 100,
      spendDate: D('2026-08-05T00:00:00Z'),
    };
    const withExtra = {
      ...plain,
      allocatedAt: D('2026-07-01T00:00:00Z'),
    } as unknown as MarketingConsumptionRow;
    expect(marketingPeriodCost([withExtra], start, end).total).toBe(
      marketingPeriodCost([plain], start, end).total,
    );
    // allocatedAt-only row (null spendDate) stays undated however allocatedAt reads.
    const allocatedOnly = {
      calculatedCost: 100,
      spendDate: null,
      allocatedAt: D('2026-08-05T00:00:00Z'),
    } as unknown as MarketingConsumptionRow;
    const res = marketingPeriodCost([allocatedOnly], start, end);
    expect(res.total).toBe(0);
    expect(res.undatedRows).toBe(1);
  });
});

describe('single-count contribution bridge (D12)', () => {
  const base = {
    netSales: 1000,
    cogs: 400,
    courierCost: 60,
    paymentFees: 20,
    marketingCost: 100,
  };

  it('TBC = Contribution Profit + Delivery Charge Retained', () => {
    const cp = computeContributionProfit(base);
    expect(cp).toBe(420);
    expect(
      computeTotalBusinessContribution({ contributionProfit: cp, deliveryChargeRetained: 80 }),
    ).toBe(500);
  });

  it('CP + Fulfillment Margin is forbidden (double-counts courier cost)', () => {
    const cp = computeContributionProfit(base);
    const fm = computeFulfillmentMargin({ deliveryChargeRetained: 80, courierCost: 60 });
    expect(fm).toBe(20);
    const forbidden = cp + fm;
    const correct = computeTotalBusinessContribution({
      contributionProfit: cp,
      deliveryChargeRetained: 80,
    });
    expect(forbidden).not.toBe(correct);
    expect(correct - forbidden).toBe(60); // exactly one courierCost apart
  });

  it('equivalent restatement (NS−COGS−PF−MK) + FM equals TBC', () => {
    const cp = computeContributionProfit(base);
    const fm = computeFulfillmentMargin({ deliveryChargeRetained: 80, courierCost: 60 });
    const restated = base.netSales - base.cogs - base.paymentFees - base.marketingCost + fm;
    // Note: restated uses CP-before-fulfillment; CP itself already deducts CC once.
    expect(restated).toBe(
      computeTotalBusinessContribution({
        contributionProfit: cp,
        deliveryChargeRetained: 80,
      }),
    );
  });

  it('Operating Profit equals Net Profit while Other Costs is not_applicable', () => {
    expect(OTHER_COSTS_STATE).toBe('not_applicable');
    const input = { totalBusinessContribution: 500, operatingExpenses: 50 };
    expect(computeOperatingProfit(input)).toBe(450);
    expect(computeOperatingProfit(input)).toBe(computeNetProfit(input));
  });

  it('component-once ledger sums to Net Profit', () => {
    const ledger = {
      grossSales: 1100,
      discounts: 100,
      returns: 0,
      refundsReversal: 0,
      deliveryChargeRetained: 80,
      cogs: 400,
      courierCost: 60,
      paymentFees: 20,
      marketingCost: 100,
      operatingExpenses: 50,
    };
    const fromLedger = computeNetProfitFromLedger(ledger);
    const cp = computeContributionProfit({
      netSales: ledger.grossSales - ledger.discounts - ledger.returns - ledger.refundsReversal,
      cogs: ledger.cogs,
      courierCost: ledger.courierCost,
      paymentFees: ledger.paymentFees,
      marketingCost: ledger.marketingCost,
    });
    const tbc = computeTotalBusinessContribution({
      contributionProfit: cp,
      deliveryChargeRetained: ledger.deliveryChargeRetained,
    });
    expect(fromLedger).toBe(computeNetProfit({ totalBusinessContribution: tbc, operatingExpenses: 50 }));
    expect(fromLedger).toBe(450);
  });
});

describe('margins (§2.5 guarantees)', () => {
  it.each([[0], [-5], [null], [undefined]] as Array<
    [number | null | undefined]
  >)('Net Sales %s ⇒ margin null (never 0%% or Infinity)', (netSales) => {
    expect(computeMargin({ profit: 100, netSales })).toBeNull();
  });

  it('positive Net Sales yields the ratio', () => {
    expect(computeMargin({ profit: 100, netSales: 1000 })).toBeCloseTo(0.1, 10);
  });
});

describe('cost states (§2.3)', () => {
  it('cost-type vocabularies are exported as consts', () => {
    expect(COGS_COST_TYPES).toStrictEqual(['actual', 'estimated']);
    expect(FULFILLMENT_COST_SOURCES).toStrictEqual([
      'manual',
      'courier_default',
    ]);
  });

  it('COGS: actual FIFO vs estimated vs missing — never a standardCost fallback', () => {
    expect(cogsLineState({ costSnapshot: 10, costType: 'actual' })).toBe('actual');
    expect(cogsLineState({ costSnapshot: 10, costType: 'estimated' })).toBe('estimated');
    expect(cogsLineState({ costSnapshot: null, costType: 'actual' })).toBe('unavailable');
    expect(cogsLineState({ costSnapshot: null, costType: 'estimated' })).toBe('unavailable');
  });

  it('fulfillment: manual/courier_default/missing map to actual/estimated/unavailable', () => {
    expect(fulfillmentCostState({ shippingCost: 60, shippingCostSource: 'manual' })).toBe('actual');
    expect(
      fulfillmentCostState({ shippingCost: 60, shippingCostSource: 'courier_default' }),
    ).toBe('estimated');
    expect(
      fulfillmentCostState({ shippingCost: null, shippingCostSource: null }),
    ).toBe('unavailable');
  });

  it('payment fee: present vs NULL', () => {
    expect(paymentFeeState({ feeAmount: 5 })).toBe('actual');
    expect(paymentFeeState({ feeAmount: null })).toBe('unavailable');
  });

  it('Other Costs has no source and is not_applicable', () => {
    expect(OTHER_COSTS_STATE).toBe('not_applicable');
  });
});

describe('movement thresholds (§2.8 default policy)', () => {
  it('threshold constants with rationale are exported', () => {
    expect(MOVEMENT_FAST_DOI_MAX).toBe(30);
    expect(MOVEMENT_SLOW_DOI_MIN).toBe(90);
    expect(typeof MOVEMENT_RATIONALE).toBe('string');
    expect(MOVEMENT_RATIONALE.length).toBeGreaterThan(0);
  });

  it('computeDOI divides closing stock by daily sales (30-day default)', () => {
    expect(computeDOI({ unitsSold: 30, closingStock: 30 })).toBe(30);
    expect(computeDOI({ unitsSold: 10, closingStock: 30, periodDays: 10 })).toBe(30);
    expect(computeDOI({ unitsSold: 0, closingStock: 5 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('computeDOI throws on negative or non-finite inputs', () => {
    expect(() => computeDOI({ unitsSold: -1, closingStock: 5 })).toThrow(
      /unitsSold/,
    );
    expect(() => computeDOI({ unitsSold: 5, closingStock: -2 })).toThrow(
      /closingStock/,
    );
    expect(() => computeDOI({ unitsSold: NaN, closingStock: 5 })).toThrow();
  });

  it('Dead = 0 units sold AND closing stock > 0', () => {
    expect(classifyMovement({ unitsSold: 0, closingStock: 5, doi: 10 })).toBe('Dead');
    expect(classifyMovement({ unitsSold: 0, closingStock: 0, doi: 10 })).not.toBe('Dead');
  });

  it('Fast DOI<=30, Slow DOI>90, Normal otherwise', () => {
    expect(classifyMovement({ unitsSold: 4, closingStock: 2, doi: 30 })).toBe('Fast');
    expect(classifyMovement({ unitsSold: 4, closingStock: 2, doi: 31 })).toBe('Normal');
    expect(classifyMovement({ unitsSold: 4, closingStock: 2, doi: 90 })).toBe('Normal');
    expect(classifyMovement({ unitsSold: 4, closingStock: 2, doi: 91 })).toBe('Slow');
  });

  it('doi defaults through computeDOI when omitted', () => {
    expect(classifyMovement({ unitsSold: 30, closingStock: 30 })).toBe('Fast');
    expect(classifyMovement({ unitsSold: 1, closingStock: 100 })).toBe('Slow');
  });

  it('negative doi throws', () => {
    expect(() =>
      classifyMovement({ unitsSold: 4, closingStock: 2, doi: -5 }),
    ).toThrow(/doi/);
  });
});

describe('shipping-refund inference (§2.10.2, online-only)', () => {
  it('no refund ⇒ full charge retained, inference none', () => {
    const r = inferDeliveryChargeRetained({ shippingCharge: 60, refundAmount: 0, collection: 'online' });
    expect(r).toStrictEqual({ state: 'actual', retained: 60, inference: 'none' });
  });

  it('refund below charge ⇒ full charge retained, inference below', () => {
    const r = inferDeliveryChargeRetained({ shippingCharge: 60, refundAmount: 30, collection: 'online' });
    expect(r.retained).toBe(60);
    expect(r.inference).toBe('below');
  });

  it('refund covering charge ⇒ retained 0, inference covered', () => {
    const r = inferDeliveryChargeRetained({ shippingCharge: 60, refundAmount: 60, collection: 'online' });
    expect(r.retained).toBe(0);
    expect(r.inference).toBe('covered');
  });

  it('COD ⇒ unavailable, no inference attempted', () => {
    const r = inferDeliveryChargeRetained({ shippingCharge: 60, refundAmount: 60, collection: 'cod' });
    expect(r.state).toBe('unavailable');
    expect(r.retained).toBeNull();
    expect(r.inference).toBe('none');
  });
});

describe('COD collection honesty (D11)', () => {
  it('COD collected/retained/deliveryChargeRetained/margin are all unavailable', () => {
    const s = COD_SETTLEMENT;
    expect(s.amountCollected).toBeNull();
    expect(s.amountRetained).toBeNull();
    expect(s.deliveryChargeRetained).toBeNull();
    expect(s.fulfillmentMargin).toBeNull();
    expect(s.state).toBe('unavailable');
    expect(s.reason).toBe(NO_COURIER_SETTLEMENT_SOURCE);
  });

  it('COD settlement is a frozen const with the exact shape', () => {
    expect(COD_SETTLEMENT).toStrictEqual({
      state: 'unavailable',
      reason: 'no_courier_settlement_source',
      amountCollected: null,
      amountRetained: null,
      deliveryChargeRetained: null,
      fulfillmentMargin: null,
    });
    expect(Object.isFrozen(COD_SETTLEMENT)).toBe(true);
  });

  it('no code path derives COD collection from order fields (behavioral)', () => {
    const base = { shippingCharge: 60, refundAmount: 60, collection: 'cod' as const };
    const withExtras = { ...base, total: 999, paymentStatus: 'PAID' };
    expect(inferDeliveryChargeRetained(withExtras)).toStrictEqual(
      inferDeliveryChargeRetained(base),
    );
  });
});
