/**
 * P2 data-layer tests — expense summary rollup (§2.9, R4/W8 support).
 *
 * Company-level only (never apportioned to products, D6). fixed/variable via
 * staff-classified expenseKind; anything else folds to unclassified.
 */
import {
  summariseExpenses,
  type ExpenseSummaryRow,
} from '../analytics-pnl.service';

const RANGE = {
  start: new Date('2026-09-01T00:00:00+06:00'),
  end: new Date('2026-09-30T17:59:59.999Z'),
};

function row(
  amount: number,
  taxAmount: number,
  expenseDate: Date,
  category: { id: string; name: string; expenseKind: string },
): ExpenseSummaryRow {
  return { amount, taxAmount, expenseDate, category };
}

describe('summariseExpenses', () => {
  it('sums amount + taxAmount by expenseDate with kind rollup', () => {
    const summary = summariseExpenses(
      [
        row(1000, 150, new Date('2026-09-10T00:00:00Z'), {
          id: 'c1',
          name: 'Rent',
          expenseKind: 'fixed',
        }),
        row(200, 0, new Date('2026-09-11T00:00:00Z'), {
          id: 'c2',
          name: 'Delivery fuel',
          expenseKind: 'variable',
        }),
        row(999, 0, new Date('2026-08-01T00:00:00Z'), {
          id: 'c1',
          name: 'Rent',
          expenseKind: 'fixed',
        }),
      ],
      RANGE,
    );
    expect(summary.total).toBe(1350);
    expect(summary.byKind).toMatchObject({
      fixed: 1150,
      variable: 200,
      unclassified: 0,
    });
    expect(summary.byCategory).toHaveLength(2);
  });

  it('folds unknown kinds to unclassified (never inferred)', () => {
    const summary = summariseExpenses(
      [
        row(100, 0, new Date('2026-09-10T00:00:00Z'), {
          id: 'c9',
          name: 'Misc',
          expenseKind: 'unclassified',
        }),
        row(50, 0, new Date('2026-09-10T00:00:00Z'), {
          id: 'c8',
          name: 'Legacy',
          expenseKind: '',
        } as any),
      ],
      RANGE,
    );
    expect(summary.byKind.unclassified).toBe(150);
    expect(summary.byKind.fixed).toBe(0);
  });
});
