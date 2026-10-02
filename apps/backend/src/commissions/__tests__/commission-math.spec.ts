import {
  calculateCommission,
  periodKeyFor,
  thresholdQualifies,
  describeRule,
  resolveBasisAmount,
} from '../commission-math';

describe('commission math', () => {
  describe('resolveBasisAmount', () => {
    const order = { total: '1200.00', subtotal: '1000.00' };

    it('uses the grand total for order_total', () => {
      expect(resolveBasisAmount(order, 'order_total').toString()).toBe('1200');
    });

    it('uses the goods-only figure for subtotal', () => {
      expect(resolveBasisAmount(order, 'subtotal').toString()).toBe('1000');
    });

    // An unrecognised basis must not silently fall back to a different figure.
    it('falls back to the total for an unknown basis', () => {
      expect(resolveBasisAmount(order, 'nonsense').toString()).toBe('1200');
    });
  });

  describe('calculateCommission — fixed', () => {
    const rule = {
      id: 'r1',
      amountType: 'fixed' as const,
      amount: '10.00',
      valueBasis: 'order_total',
      minOrderAmount: null,
      capPerOrder: null,
      minimumCount: null,
      thresholdPeriod: null,
    };

    it('pays the flat amount regardless of order size', () => {
      const r = calculateCommission(rule, { total: '50', subtotal: '50' });
      expect(r?.amount.toString()).toBe('10');
    });

    it('rounds half up to 2dp', () => {
      const r = calculateCommission(
        { ...rule, amount: '10.005' },
        { total: '100', subtotal: '100' },
      );
      expect(r?.amount.toString()).toBe('10.01');
    });
  });

  describe('calculateCommission — percentage', () => {
    const rule = {
      id: 'r1',
      amountType: 'percent' as const,
      amount: '1.00',
      valueBasis: 'order_total',
      minOrderAmount: null,
      capPerOrder: null,
      minimumCount: null,
      thresholdPeriod: null,
    };

    it('computes rate × basis / 100', () => {
      const r = calculateCommission(rule, { total: '1000', subtotal: '1000' });
      expect(r?.amount.toString()).toBe('10');
    });

    it('measures against the named basis, not always the total', () => {
      const r = calculateCommission(
        { ...rule, valueBasis: 'subtotal' },
        { total: '1200', subtotal: '1000' },
      );
      // 1% of 1000, not of 1200.
      expect(r?.amount.toString()).toBe('10');
      expect(r?.sourceAmount.toString()).toBe('1000');
    });

    it('rounds to paisa deterministically', () => {
      // 0.5% of 999 = 4.995 → 5.00 half-up, not 4.99.
      const r = calculateCommission(
        { ...rule, amount: '0.50' },
        { total: '999', subtotal: '999' },
      );
      expect(r?.amount.toString()).toBe('5');
    });

    it('returns null when the result rounds to zero', () => {
      const r = calculateCommission(
        { ...rule, amount: '0.00' },
        { total: '999', subtotal: '999' },
      );
      expect(r).toBeNull();
    });
  });

  describe('calculateCommission — gates and cap', () => {
    const base = {
      id: 'r1',
      amountType: 'fixed' as const,
      amount: '10.00',
      valueBasis: 'order_total',
      minOrderAmount: null,
      capPerOrder: null,
      minimumCount: null,
      thresholdPeriod: null,
    };

    // §20: minimum ORDER AMOUNT is an additional per-order condition, distinct
    // from the count threshold. Both can apply.
    it('skips an order below the minimum amount', () => {
      const r = calculateCommission(
        { ...base, minOrderAmount: '500.00' },
        { total: '499', subtotal: '499' },
      );
      expect(r).toBeNull();
    });

    it('pays an order at the minimum amount boundary', () => {
      const r = calculateCommission(
        { ...base, minOrderAmount: '500.00' },
        { total: '500', subtotal: '500' },
      );
      expect(r?.amount.toString()).toBe('10');
    });

    it('applies the cap and reports that it did', () => {
      const r = calculateCommission(
        { ...base, capPerOrder: '5.00' },
        { total: '1000', subtotal: '1000' },
      );
      expect(r?.amount.toString()).toBe('5');
      expect(r?.capApplied).toBe(true);
    });

    it('does not report a cap when the amount is under it', () => {
      const r = calculateCommission(
        { ...base, capPerOrder: '50.00' },
        { total: '1000', subtotal: '1000' },
      );
      expect(r?.capApplied).toBe(false);
    });
  });

  describe('periodKeyFor — Dhaka business periods', () => {
    const at = (iso: string) => new Date(iso);

    it('buckets by Dhaka calendar day, not UTC day', () => {
      // 18:30 UTC is 00:30 the next day in Dhaka. A UTC-based key would say the
      // 2nd; the business day is the 3rd.
      const t = at('2026-10-02T18:30:00.000Z');
      expect(periodKeyFor('daily', t)).toBe('2026-10-03');
    });

    it('keeps a late-evening UTC time in the same Dhaka day', () => {
      const t = at('2026-10-02T15:00:00.000Z'); // 21:00 Dhaka, same day
      expect(periodKeyFor('daily', t)).toBe('2026-10-02');
    });

    it('buckets by month across the Dhaka boundary', () => {
      // 2026-10-31 18:30 UTC is 2026-11-01 00:30 Dhaka.
      expect(periodKeyFor('monthly', at('2026-10-31T18:30:00.000Z'))).toBe('2026-11');
    });

    it('buckets by year', () => {
      expect(periodKeyFor('yearly', at('2026-06-15T06:00:00.000Z'))).toBe('2026');
    });

    it('produces an ISO week key that separates adjacent weeks', () => {
      const w1 = periodKeyFor('weekly', at('2026-10-01T06:00:00.000Z'));
      const w2 = periodKeyFor('weekly', at('2026-10-12T06:00:00.000Z'));
      expect(w1).not.toBe(w2);
      expect(w1).toMatch(/^2026-W\d{2}$/);
    });

    it('groups the same Dhaka week together regardless of weekday', () => {
      // Mon 2026-10-05 and Sun 2026-10-11 are the same Monday-based week.
      expect(periodKeyFor('weekly', at('2026-10-05T06:00:00.000Z'))).toBe(
        periodKeyFor('weekly', at('2026-10-11T06:00:00.000Z')),
      );
    });
  });

  describe('thresholdQualifies', () => {
    // §9: the period's count is filled to the threshold first; commission starts
    // from the event after the threshold.
    it('does not pay the threshold-crossing event itself', () => {
      expect(thresholdQualifies(50, 49)).toEqual({ qualifies: false, countAfter: 50 });
    });

    it('pays the first event beyond the threshold', () => {
      expect(thresholdQualifies(50, 50)).toEqual({ qualifies: true, countAfter: 51 });
    });

    it('pays every subsequent event', () => {
      expect(thresholdQualifies(50, 99).qualifies).toBe(true);
    });

    it('pays nothing before the period starts counting', () => {
      expect(thresholdQualifies(50, 0)).toEqual({ qualifies: false, countAfter: 1 });
    });
  });

  describe('describeRule', () => {
    it('explains a plain fixed rule', () => {
      const s = describeRule({
        employeeName: 'Rahim',
        purpose: 'Packed',
        amountType: 'fixed',
        amount: '10',
        minimumCount: null,
        thresholdPeriod: null,
      });
      expect(s).toContain('Rahim');
      expect(s).toContain('৳10.00');
      expect(s).toContain('Packed');
    });

    it('explains the threshold semantics in plain language', () => {
      const s = describeRule({
        employeeName: 'Rahim',
        purpose: 'Packed',
        amountType: 'fixed',
        amount: '10',
        minimumCount: 50,
        thresholdPeriod: 'daily',
      });
      expect(s).toContain('50 qualifying Packed orders each daily');
      expect(s).toContain('from order #51 onward');
    });

    it('distinguishes a percentage rule', () => {
      const s = describeRule({
        employeeName: 'Rahim',
        purpose: 'Delivered',
        amountType: 'percent',
        amount: '0.5',
        minimumCount: null,
        thresholdPeriod: null,
      });
      expect(s).toContain('0.50%');
    });
  });
});