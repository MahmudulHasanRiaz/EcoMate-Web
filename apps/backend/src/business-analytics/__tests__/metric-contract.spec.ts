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
import { readFileSync } from 'fs';
import { join } from 'path';
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
  marketingPeriodCost,
  marketingIdentityTotals,
  MOVEMENT_FAST_DOI_MAX,
  MOVEMENT_SLOW_DOI_MIN,
  MOVEMENT_RATIONALE,
  classifyMovement,
  inferDeliveryChargeRetained,
  codSettlement,
  computeContributionProfit,
  computeFulfillmentMargin,
  computeTotalBusinessContribution,
  computeNetProfit,
  computeNetProfitFromLedger,
  computeMargin,
  type TimelineEntry,
} from '../metric-contract';

const D = (iso: string): Date => new Date(iso);
const entry = (status: string, timestamp: string): TimelineEntry => ({
  status,
  timestamp,
});

describe('lifecycle vocabulary (§1.3)', () => {
  it('covers every status in the order transition map', () => {
    expect(ORDER_STATUSES).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    for (const s of ORDER_STATUSES) {
      expect(STATUS_META[s]).toBeDefined();
    }
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
  ])('isFinal(%s) === %s', (status, expected) => {
    expect(isFinalStatus(status)).toBe(expected);
  });

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

  it('Delivered transition date wins over createdAt', () => {
    const timeline = [
      entry('Pending', '2026-08-01T10:00:00Z'),
      entry('Delivered', '2026-08-05T12:00:00Z'),
    ];
    const evt = resolveRevenueEvent({
      timeline,
      createdAt: D('2026-08-01T10:00:00Z'),
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

  it('findDeliveredTransition returns the first Delivered transition', () => {
    const timeline = [
      entry('Pending', '2026-08-01T10:00:00Z'),
      entry('Delivered', '2026-08-05T12:00:00Z'),
      entry('Return Pending', '2026-08-07T12:00:00Z'),
    ];
    expect(findDeliveredTransition(timeline)?.status).toBe('Delivered');
    expect(findDeliveredTransition([entry('Pending', '2026-08-01T10:00:00Z')])).toBeNull();
  });

  it('findReturnTransition matches Returned or Damaged', () => {
    expect(
      findReturnTransition([entry('Damaged', '2026-08-09T00:00:00Z')])?.status,
    ).toBe('Damaged');
    expect(
      findReturnTransition([entry('Delivered', '2026-08-05T00:00:00Z')]),
    ).toBeNull();
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

  it('refund without return reverses where applicable', () => {
    expect(classifyRefund({ wasDelivered: true, wasReturned: false })).toBe(
      'reversal',
    );
    expect(classifyRefund({ wasDelivered: false, wasReturned: false })).toBe(
      'not_a_reversal',
    );
  });

  it('multiple and partial refunds each classify independently', () => {
    expect(
      classifyRefunds({ wasDelivered: true, wasReturned: false }, [{}, {}, {}]),
    ).toEqual(['reversal', 'reversal', 'reversal']);
    expect(
      classifyRefunds({ wasDelivered: true, wasReturned: true }, [{}, {}]),
    ).toEqual(['informational', 'informational']);
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

  it('R17 identity: all-time == dated + undated, undated never in a period total', () => {
    const id = marketingIdentityTotals(rows);
    expect(id.allTimeCost).toBe(180);
    expect(id.datedCost + id.undatedCost).toBe(id.allTimeCost);
    expect(id.undatedCost).toBe(30);
  });

  it('allocatedAt is never a financial date input (structural)', () => {
    const src = readFileSync(join(__dirname, '..', 'metric-contract.ts'), 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(stripped).not.toMatch(/allocatedAt\s*[:?]/);
    expect(stripped).not.toMatch(/allocatedAt\s*[,)]/);
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
    void cp;
    expect(restated).toBe(
      computeTotalBusinessContribution({
        contributionProfit: cp,
        deliveryChargeRetained: 80,
      }),
    );
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
  it.each([[0], [-5], [null], [undefined]])(
    'Net Sales %s ⇒ margin null (never 0%% or Infinity)',
    (netSales) => {
      expect(computeMargin({ profit: 100, netSales: netSales as never })).toBeNull();
    },
  );

  it('positive Net Sales yields the ratio', () => {
    expect(computeMargin({ profit: 100, netSales: 1000 })).toBeCloseTo(0.1, 10);
  });
});

describe('cost states (§2.3)', () => {
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
});

describe('shipping-refund inference (§2.10.2, online-only)', () => {
  it('no refund ⇒ full charge retained, inference none', () => {
    const r = inferDeliveryChargeRetained({ shippingCharge: 60, refundAmount: 0, collection: 'online' });
    expect(r).toEqual({ state: 'actual', retained: 60, inference: 'none' });
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
    const s = codSettlement();
    expect(s.amountCollected).toBeNull();
    expect(s.amountRetained).toBeNull();
    expect(s.deliveryChargeRetained).toBeNull();
    expect(s.fulfillmentMargin).toBeNull();
    expect(s.state).toBe('unavailable');
    expect(s.reason).toBe('no_courier_settlement_source');
  });

  it('no code path derives COD collection from order fields (structural)', () => {
    const src = readFileSync(join(__dirname, '..', 'metric-contract.ts'), 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(stripped).not.toMatch(/Order\.total/);
    expect(stripped).not.toMatch(/\.total\b/);
    expect(stripped).not.toMatch(/paymentStatus/);
  });
});
