// ── P3 settlement semantics tests: the 8 money concepts + §3 decomposition.
// These are the executable Truth Table rows 1–5 plus expectedCod precedence.

import {
  derivedDue,
  expectedCod,
  residualOf,
  codPosition,
  outstandingCod,
  payableToCourier,
  collectionShortfall,
  remittanceShortfall,
  cashReceived,
  cashDisbursed,
  residualSeverity,
} from '../economics';
import { matchRow, emptyIndexes, norm } from '../reconciliation/matcher';

describe('expectedCod — derived due (D-C actuals-only ledger)', () => {
  const base = { total: 1000, payments: [], trashedAt: null, statusName: 'Processing' } as const;

  it('is 0 for a non-COD order', () => {
    const r = expectedCod({ ...base, paymentOptionType: 'FULL_PAYMENT' });
    expect(r.value).toBe(0);
    expect(r.source).toBe('not_cod');
  });

  it('is 0 for a trashed COD order', () => {
    const r = expectedCod({ ...base, paymentOptionType: 'CASH_ON_DELIVERY', trashedAt: new Date() });
    expect(r.value).toBe(0);
  });

  it('is 0 for a cancelled COD order', () => {
    const r = expectedCod({
      ...base,
      paymentOptionType: 'CASH_ON_DELIVERY',
      statusName: 'Cancelled',
    });
    expect(r.value).toBe(0);
  });

  it('is total − ΣPAID: only received money reduces what the courier collects', () => {
    const r = expectedCod({
      ...base,
      paymentOptionType: 'CASH_ON_DELIVERY',
      payments: [
        { amount: 400, gatewayCode: 'bkash', status: 'PAID' },
        { amount: 999, gatewayCode: 'cash', status: 'PENDING' },
        { amount: 999, gatewayCode: 'cash', status: 'FAILED' },
        { amount: 999, gatewayCode: 'cash', status: 'VOID' },
      ],
    });
    expect(r.value).toBe(600);
    expect(r.divergence).toBe(false);
  });

  it('subtracts appliedCreditAmount (mirrors the cod-mismatch systemDue formula)', () => {
    const r = expectedCod({
      ...base,
      total: 1500,
      paymentOptionType: 'CASH_ON_DELIVERY',
      payments: [
        { amount: 1000, gatewayCode: 'bkash', status: 'PAID', appliedCreditAmount: 200 },
        { amount: 500, gatewayCode: 'bkash', status: 'PENDING', appliedCreditAmount: null },
      ],
    });
    // systemDue = 1500 − 1000 − 200 = 300 (same numbers as cod-mismatch.spec)
    expect(r.value).toBe(300);
  });

  it('is Order.total when no payment row exists yet', () => {
    const r = expectedCod({ ...base, paymentOptionType: 'CASH_ON_DELIVERY' });
    expect(r.value).toBe(1000);
    expect(r.source).toBe('order_total_fallback');
  });

  it('floors at 0 on overpayment (excess becomes credit, never negative due)', () => {
    const r = expectedCod({
      ...base,
      paymentOptionType: 'CASH_ON_DELIVERY',
      payments: [{ amount: 1200, gatewayCode: 'bkash', status: 'PAID' }],
    });
    expect(r.value).toBe(0);
  });

  it('excludes courier_settlement PAID rows (settled money is journal-reconciled, not a due reduction)', () => {
    const r = expectedCod({
      ...base,
      total: 770,
      paymentOptionType: 'CASH_ON_DELIVERY',
      payments: [{ amount: 770, gatewayCode: 'courier_settlement', status: 'PAID' }],
    });
    // Gross courier expectation stays 770 — the settlement row must not collapse it.
    expect(r.value).toBe(770);
  });

  it('settled order (770/770 settlement, charges 50, net 720) nets to zero balances', () => {
    const expected = expectedCod({
      ...base,
      total: 770,
      paymentOptionType: 'CASH_ON_DELIVERY',
      payments: [{ amount: 770, gatewayCode: 'courier_settlement', status: 'PAID' }],
    }).value;
    const pos = codPosition({ expectedCod: expected, charges: 50, netCashMovement: 720 });
    expect(pos).toBe(0);
    expect(outstandingCod(pos)).toBe(0);
    expect(payableToCourier(pos)).toBe(0);
  });
});

describe('derivedDue (shared helper)', () => {
  it('equals total − ΣPAID − ΣappliedCredit, floored at 0', () => {
    expect(derivedDue(1000, [])).toBe(1000);
    expect(
      derivedDue(1000, [
        { amount: 400, status: 'PAID' },
        { amount: 999, status: 'PENDING' },
      ]),
    ).toBe(600);
    expect(
      derivedDue(1000, [{ amount: 800, status: 'PAID', appliedCreditAmount: 200 }]),
    ).toBe(0);
    expect(derivedDue(1000, [{ amount: 1500, status: 'PAID' }])).toBe(0);
  });
});

describe('§3 decomposition + worked checks (executable)', () => {
  const check = (
    label: string,
    expected: number,
    collected: number,
    charges: number,
    net: number,
    wantPosition: number,
    wantOutstanding: number,
    wantPayable: number,
  ) => {
    it(label, () => {
      const pos = codPosition({ expectedCod: expected, charges, netCashMovement: net });
      expect(pos).toBeCloseTo(wantPosition, 2);
      expect(outstandingCod(pos)).toBeCloseTo(wantOutstanding, 2);
      expect(payableToCourier(pos)).toBeCloseTo(wantPayable, 2);
      // identity per row: collected − charges − net = residual
      expect(residualOf(collected, charges, net)).toBeCloseTo(collected - charges - net, 2);
      // decomposition proof when both terms non-negative
      const cs = collectionShortfall(expected, collected);
      const rs = remittanceShortfall(collected, charges, net);
      if (cs >= 0 && rs >= 0) {
        expect(cs + rs).toBeCloseTo(pos, 2);
      }
    });
  };

  check('settled, fee deducted (1000/1000/100/900)', 1000, 1000, 100, 900, 0, 0, 0);
  check('collected but unpaid (1000/1000/100/0)', 1000, 1000, 100, 0, 900, 900, 0);
  check('no invoice (1000/0/0/0)', 1000, 0, 0, 0, 1000, 1000, 0);
  check('partial (1000/400/100/300)', 1000, 400, 100, 300, 600, 600, 0);
  check('prepaid billed CarryBee (0/0/100/−100)', 0, 0, 100, -100, 0, 0, 0);
  check('return with costs (0/0/200/−200)', 0, 0, 200, -200, 0, 0, 0);
});

describe('waterfall components (§2.5, §2.6)', () => {
  it('splits a signed net into received/disbursed', () => {
    expect(cashReceived(900)).toBe(900);
    expect(cashDisbursed(900)).toBe(0);
    expect(cashReceived(-100)).toBe(0);
    expect(cashDisbursed(-100)).toBe(100);
    expect(cashReceived(0)).toBe(0);
    expect(cashDisbursed(0)).toBe(0);
  });
});

describe('residual policy (§4.6)', () => {
  it('rounding ≤ 0.05 → none; mid → yellow; large → red', () => {
    expect(residualSeverity(0.04, 100)).toBe('none');
    expect(residualSeverity(50, 100)).toBe('yellow');
    expect(residualSeverity(150, 100)).toBe('red');
    expect(residualSeverity(-150, 100)).toBe('red');
  });
});

describe('matcher (§9) — index-driven, no per-row query', () => {
  const idx = emptyIndexes();
  idx.dispatchByConsignment.set(norm('DF2409ABC'), { id: 'd1', orderId: 'o1' });
  idx.dispatchByTracking.set(norm('SFR123'), { id: 'd2', orderId: 'o2' });
  idx.orderByDisplayId.set(norm('ORD-1'), { id: 'o3' });
  idx.orderByExternalId.set(norm('163398958'), { id: 'o4' });
  idx.orderByConsignment.set(norm('SP-INV-1'), { id: 'o5' });
  idx.orderByTracking.set(norm('TRK-X'), { id: 'o6' });

  it('matches by consignment via dispatch', () => {
    const r = matchRow(
      { rowNumber: 1, consignmentId: 'DF2409ABC' },
      ['consignmentId', 'displayId'],
      idx,
    );
    expect(r.matchMethod).toBe('BY_CONSIGNMENT');
    expect(r.orderId).toBe('o1');
    expect(r.dispatchId).toBe('d1');
  });

  it('matches by order displayId', () => {
    const r = matchRow({ rowNumber: 2, displayId: 'ORD-1' }, ['displayId'], idx);
    expect(r.matchMethod).toBe('BY_ORDER_DISPLAYID');
    expect(r.orderId).toBe('o3');
  });

  it('matches by external order id', () => {
    const r = matchRow({ rowNumber: 3, displayId: '163398958' }, ['displayId'], idx);
    expect(r.matchMethod).toBe('BY_ORDER_EXTERNALID');
    expect(r.orderId).toBe('o4');
  });

  it('matches by tracking via dispatch', () => {
    const r = matchRow({ rowNumber: 4, trackingCode: 'SFR123' }, ['trackingCode'], idx);
    expect(r.matchMethod).toBe('BY_TRACKING');
    expect(r.orderId).toBe('o2');
  });

  it('matches an order by consignment fallback (no dispatch)', () => {
    const r = matchRow({ rowNumber: 5, consignmentId: 'SP-INV-1' }, ['consignmentId'], idx);
    expect(r.matchMethod).toBe('BY_CONSIGNMENT');
    expect(r.orderId).toBe('o5');
  });

  it('returns NONE with an explanation when nothing resolves', () => {
    const r = matchRow({ rowNumber: 6, consignmentId: 'GHOST' }, ['consignmentId', 'displayId'], idx);
    expect(r.matchMethod).toBe('NONE');
    expect(r.orderId).toBeUndefined();
    expect(r.matchContext.attemptedOrder).toEqual(['consignmentId', 'displayId']);
  });

  it('is case-insensitive and trims identifiers', () => {
    const r = matchRow({ rowNumber: 7, consignmentId: '  df2409abc ' }, ['consignmentId'], idx);
    expect(r.orderId).toBe('o1');
  });
});