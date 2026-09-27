// ── P7 accounting tests: §4 cases A–D + the §8.2 correction truth table.
//
// Position deltas use the canonical formula (user ruling): codPosition moves by
// −(ΔC + ΔN). Where the §8.2 table's position column disagrees with that formula
// (row 5b), the canonical value is asserted and the deviation is noted inline.

import {
  buildFinalizationEntry,
  buildCorrectionEntry,
  codPositionDelta,
  costDelta,
  describeEntry,
  type EntryResult,
  type LedgerLine,
} from '../accounting/courier-accounting';

function find(res: EntryResult, account: LedgerLine['account']): LedgerLine | undefined {
  return res.lines.find((l) => l.account === account);
}

describe('§4 finalization entry — cases A–D + balance proof', () => {
  it('Case A: gross 1000 · cost 100 · net 900 → Dr Cash 900 · Dr Expense 100 · Cr Clearing 1000', () => {
    const res = buildFinalizationEntry({ gross: 1000, charges: 100, net: 900 });
    expect(find(res, 'cash')).toMatchObject({ debit: 900, credit: 0 });
    expect(find(res, 'expense')).toMatchObject({ debit: 100, credit: 0 });
    expect(find(res, 'clearing')).toMatchObject({ debit: 0, credit: 1000 });
    expect(find(res, 'variance')).toBeUndefined();
    expect(res.residual).toBe(0);
    expect(res.balanced).toBe(true);
    expect(res.totalDebit).toBe(1000);
    expect(res.totalCredit).toBe(1000);
  });

  it('Case B: gross 1000 · cost 1000 · net 0 → Dr Expense 1000 · Cr Clearing 1000', () => {
    const res = buildFinalizationEntry({ gross: 1000, charges: 1000, net: 0 });
    expect(find(res, 'cash')).toBeUndefined();
    expect(find(res, 'expense')).toMatchObject({ debit: 1000, credit: 0 });
    expect(find(res, 'clearing')).toMatchObject({ debit: 0, credit: 1000 });
    expect(res.balanced).toBe(true);
  });

  it('Case C: gross 1000 · cost 1200 · net −200 → Dr Expense 1200 · Cr Cash 200 · Cr Clearing 1000', () => {
    const res = buildFinalizationEntry({ gross: 1000, charges: 1200, net: -200 });
    expect(find(res, 'expense')).toMatchObject({ debit: 1200, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 200 });
    expect(find(res, 'clearing')).toMatchObject({ debit: 0, credit: 1000 });
    expect(res.balanced).toBe(true);
    expect(res.totalDebit).toBe(1200);
    expect(res.totalCredit).toBe(1200);
  });

  it('Case D: return, gross 0 · cost 100 · net −100 → Dr Expense 100 · Cr Cash 100', () => {
    const res = buildFinalizationEntry({ gross: 0, charges: 100, net: -100 });
    expect(find(res, 'expense')).toMatchObject({ debit: 100, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 100 });
    expect(find(res, 'clearing')).toBeUndefined();
    expect(res.balanced).toBe(true);
  });

  it('never books residual as expense — it goes to variance', () => {
    const res = buildFinalizationEntry({ gross: 1000, charges: 100, net: 800 });
    expect(res.residual).toBe(100);
    expect(find(res, 'variance')).toMatchObject({ debit: 100, credit: 0 });
    expect(find(res, 'expense')).toMatchObject({ debit: 100, credit: 0 }); // cost only
    expect(res.balanced).toBe(true);
  });

  it('balances for every sign of net including residual', () => {
    for (const [g, c, n] of [
      [1000, 100, 900],
      [1000, 1000, 0],
      [1000, 1200, -200],
      [0, 100, -100],
      [1000, 100, 800],
      [1000, 100, 950],
    ]) {
      const res = buildFinalizationEntry({ gross: g, charges: c, net: n });
      expect(res.balanced).toBe(true);
    }
  });
});

describe('§8.2 correction truth table', () => {
  it('row 1a: cost-only, counterpart net → Dr Expense 20 / Cr Cash 20; cost 120; position unchanged', () => {
    const res = buildCorrectionEntry({ deltaG: 0, deltaC: 20, deltaN: -20, counterpart: 'net' });
    expect(res.rejected).toBe(false);
    expect(res.deltaR).toBe(0);
    expect(find(res, 'expense')).toMatchObject({ debit: 20, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 20 });
    expect(res.balanced).toBe(true);
    expect(costDelta(20)).toBe(20);
    expect(codPositionDelta(20, -20)).toBe(0);
  });

  it('row 1b: cost-only, counterpart gross → Dr Expense 20 / Cr Clearing 20; position −20 (OVER_SETTLEMENT)', () => {
    const res = buildCorrectionEntry({ deltaG: 20, deltaC: 20, deltaN: 0, counterpart: 'gross' });
    expect(res.deltaR).toBe(0);
    expect(find(res, 'expense')).toMatchObject({ debit: 20, credit: 0 });
    expect(find(res, 'clearing')).toMatchObject({ debit: 0, credit: 20 });
    expect(codPositionDelta(20, 0)).toBe(-20);
  });

  it('row 2a: net-only, counterpart gross → Dr Clearing 50 / Cr Cash 50; position +50', () => {
    const res = buildCorrectionEntry({ deltaG: -50, deltaC: 0, deltaN: -50, counterpart: 'gross' });
    expect(res.deltaR).toBe(0);
    expect(find(res, 'clearing')).toMatchObject({ debit: 50, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 50 });
    expect(codPositionDelta(0, -50)).toBe(50);
  });

  it('row 2b: net-only, counterpart variance → Dr Variance 50 / Cr Cash 50 + UNEXPLAINED', () => {
    const res = buildCorrectionEntry({ deltaG: 0, deltaC: 0, deltaN: -50, counterpart: 'variance' });
    expect(res.deltaR).toBe(50);
    expect(res.counterpartUsed).toBe(true);
    expect(find(res, 'variance')).toMatchObject({ debit: 50, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 50 });
    expect(res.balanced).toBe(true);
    expect(codPositionDelta(0, -50)).toBe(50);
  });

  it('row 3: cost+net paired (ΔR=0) → Dr Expense 20 / Cr Cash 20; position unchanged', () => {
    const res = buildCorrectionEntry({ deltaG: 0, deltaC: 20, deltaN: -20 });
    expect(res.rejected).toBe(false);
    expect(res.deltaR).toBe(0);
    expect(find(res, 'expense')).toMatchObject({ debit: 20, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 20 });
    expect(codPositionDelta(20, -20)).toBe(0);
  });

  it('row 5a: zero-payout regime + fee→1020, counterpart net → Dr Expense 20 / Cr Cash 20', () => {
    const res = buildCorrectionEntry({ deltaG: 0, deltaC: 20, deltaN: -20, counterpart: 'net' });
    expect(find(res, 'expense')).toMatchObject({ debit: 20, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 20 });
    expect(codPositionDelta(20, -20)).toBe(0);
  });

  it('row 5b: zero-payout regime + fee→1020, counterpart gross → Dr Expense 20 / Cr Clearing 20', () => {
    const res = buildCorrectionEntry({ deltaG: 20, deltaC: 20, deltaN: 0, counterpart: 'gross' });
    expect(find(res, 'expense')).toMatchObject({ debit: 20, credit: 0 });
    expect(find(res, 'clearing')).toMatchObject({ debit: 0, credit: 20 });
    // Canonical formula: position = expectedCod − charges − net = 1000−1020−0 = −20.
    // (§8.2 table annotates 0 here; the canonical formula and §3 decomposition win.)
    expect(codPositionDelta(20, 0)).toBe(-20);
  });

  it('row 6: negative-payout regime + billing 100→120, counterpart net → Dr Expense 20 / Cr Cash 20', () => {
    const res = buildCorrectionEntry({ deltaG: 0, deltaC: 20, deltaN: -20, counterpart: 'net' });
    expect(find(res, 'expense')).toMatchObject({ debit: 20, credit: 0 });
    expect(find(res, 'cash')).toMatchObject({ debit: 0, credit: 20 });
    expect(codPositionDelta(20, -20)).toBe(0);
  });
});

describe('§8.2 counterpart validation', () => {
  it('rejects a correction whose ΔR ≠ 0 has no declared counterpart', () => {
    const res = buildCorrectionEntry({ deltaG: 0, deltaC: 50, deltaN: 0 });
    expect(res.deltaR).toBe(-50);
    expect(res.rejected).toBe(true);
    expect(res.lines).toHaveLength(0);
    expect(res.rejectionReason).toMatch(/counterpart/i);
  });

  it('accepts ΔR = 0 without a counterpart', () => {
    const res = buildCorrectionEntry({ deltaG: 0, deltaC: 20, deltaN: -20 });
    expect(res.rejected).toBe(false);
  });

  it('flags variance-over-threshold as red-grade', () => {
    const res = buildCorrectionEntry({
      deltaG: 0, deltaC: 0, deltaN: -50, counterpart: 'variance', residualThreshold: 20,
    });
    expect(res.varianceOverThreshold).toBe(true);
  });

  it('describeEntry renders the Dr/Cr label', () => {
    const res = buildFinalizationEntry({ gross: 1000, charges: 100, net: 900 });
    const label = describeEntry(res);
    expect(label).toContain('Dr cash 900.00');
    expect(label).toContain('Dr expense 100.00');
    expect(label).toContain('Cr clearing 1000.00');
  });
});