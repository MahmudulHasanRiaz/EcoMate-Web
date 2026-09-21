/**
 * P9 expense analytics tests (§2.9 + §4.2 expense rows + §8.6 + §7.1).
 *
 * Pure kind/ratio/growth math (unknown kinds fold to unclassified — never
 * inferred) · revenue% and per-order null-guards (never 0/zero-filled) ·
 * Dhaka-bucket trend · Budget vs Actual always unavailable, never zero ·
 * no trashedAt filter (Expense has no trash field) · service fetch wiring
 * (range + narrow, kind via the category relation) · R4 reuse (the P2
 * summariseExpenses rollup is reused, never reimplemented) · FULL financial
 * perms live on the controller (asserted in business-analytics.controller.spec).
 */
import {
  classifyExpenseKind,
  computeExpenseRevenuePct,
  computeExpensePerOrder,
  computeExpenseGrowth,
  bucketExpenseTrend,
  BUDGET_VS_ACTUAL_REASON,
  EXPENSE_DATE_BASIS,
  EXPENSE_KIND_NOTE,
  EXPENSE_DRILL_LABEL,
  type ExpenseRowInput,
} from '../analytics-expenses.service';
import { AnalyticsExpensesService } from '../analytics-expenses.service';
import { AnalyticsFilterService } from '../analytics-filter.service';

const RANGE = {
  start: new Date('2026-09-01T00:00:00+06:00'),
  end: new Date('2026-09-07T17:59:59.999Z'),
};

function row(
  amount: number,
  taxAmount: number,
  expenseDate: Date,
): ExpenseRowInput {
  return { amount, taxAmount, expenseDate };
}

// ─── kind classification (never inferred) ────────────────────────────────────

describe('classifyExpenseKind', () => {
  it.each(['fixed', 'variable'])('keeps staff-classified %s', (kind) => {
    expect(classifyExpenseKind(kind)).toBe(kind);
  });

  it.each(['unclassified', '', null, undefined, 'FIXED', 'capex', 42, {}])(
    'folds unknown %p to unclassified',
    (kind) => {
      expect(classifyExpenseKind(kind)).toBe('unclassified');
    },
  );
});

// ─── ratio null-guards (never 0, never Infinity, never zero-filled) ──────────

describe('computeExpenseRevenuePct', () => {
  it('returns the ratio when Net Sales is positive', () => {
    expect(computeExpenseRevenuePct(1350, 10000)).toBeCloseTo(0.135);
  });

  it.each([0, -100])('returns null when Net Sales is %p', (ns) => {
    expect(computeExpenseRevenuePct(1350, ns)).toBeNull();
  });

  it.each([NaN, Infinity, null, undefined])(
    'returns null when Net Sales is %p',
    (ns) => {
      expect(computeExpenseRevenuePct(1350, ns as any)).toBeNull();
    },
  );
});

describe('computeExpensePerOrder', () => {
  it('divides by recognised orders', () => {
    expect(computeExpensePerOrder(1350, 27)).toBe(50);
  });

  it.each([0, -1])('returns null when recognised orders is %p', (orders) => {
    expect(computeExpensePerOrder(1350, orders)).toBeNull();
  });
});

// ─── growth (previous window of identical length) ────────────────────────────

describe('computeExpenseGrowth', () => {
  it('reports delta + pct against the previous total', () => {
    expect(computeExpenseGrowth(1350, 1000)).toEqual({
      delta: 350,
      deltaPct: 35,
    });
  });

  it('leaves deltaPct null (never 0%/Infinity) when previous is 0', () => {
    expect(computeExpenseGrowth(1350, 0)).toEqual({
      delta: 1350,
      deltaPct: null,
    });
  });
});

// ─── Dhaka-bucket trend ──────────────────────────────────────────────────────

describe('bucketExpenseTrend', () => {
  it('sums amount + taxAmount per Dhaka bucket edge', () => {
    const edges = [
      {
        start: new Date('2026-09-01T00:00:00+06:00'),
        end: new Date('2026-09-01T23:59:59.999+06:00'),
        label: '2026-09-01',
      },
      {
        start: new Date('2026-09-02T00:00:00+06:00'),
        end: new Date('2026-09-02T23:59:59.999+06:00'),
        label: '2026-09-02',
      },
    ];
    const points = bucketExpenseTrend(
      [
        row(1000, 150, new Date('2026-09-01T10:00:00+06:00')),
        row(200, 0, new Date('2026-09-02T10:00:00+06:00')),
        row(999, 0, new Date('2026-08-01T10:00:00+06:00')),
      ],
      edges,
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      label: '2026-09-01',
      amount: 1150,
      expenses: 1,
    });
    expect(points[1]).toMatchObject({
      label: '2026-09-02',
      amount: 200,
      expenses: 1,
    });
    expect(points[0].bucketStart).toBe(
      new Date('2026-09-01T00:00:00+06:00').toISOString(),
    );
  });
});

// ─── disclosure strings ──────────────────────────────────────────────────────

describe('expense disclosure strings', () => {
  it('states the expenseDate basis, the never-inferred kind policy, the drill path and the budget gap', () => {
    expect(EXPENSE_DATE_BASIS).toMatch(/expenseDate/i);
    expect(EXPENSE_KIND_NOTE).toMatch(/never inferred/i);
    expect(EXPENSE_DRILL_LABEL).toMatch(/category/i);
    expect(BUDGET_VS_ACTUAL_REASON).toMatch(/no budget model/i);
    expect(BUDGET_VS_ACTUAL_REASON).toMatch(/never zero/i);
  });
});

// ─── service wiring ──────────────────────────────────────────────────────────

function makeService(opts: {
  expenses?: any[];
  categories?: any[];
  expenseCount?: number;
  netSales?: number | null;
  recognisedOrders?: number;
  cached?: unknown;
}) {
  const findMany = jest.fn().mockImplementation((args: any) => {
    if (args?.select?.description !== undefined) {
      // List endpoint selects row fields.
      return Promise.resolve(opts.expenses ?? []);
    }
    return Promise.resolve(opts.expenses ?? []);
  });
  const prisma: any = {
    expense: {
      findMany,
      count: jest.fn().mockResolvedValue(opts.expenseCount ?? 0),
    },
    expenseCategory: {
      findMany: jest.fn().mockResolvedValue(opts.categories ?? []),
    },
  };
  const filters = new AnalyticsFilterService(prisma);
  const cache: any = {
    get: jest.fn().mockResolvedValue(opts.cached),
    set: jest.fn(),
  };
  const pnl: any = {
    getPnl: jest.fn().mockResolvedValue({
      data: {
        lines: {
          netSales: {
            value: opts.netSales ?? null,
            state: (opts.netSales ?? 0) > 0 ? 'ok' : 'no_data',
          },
        },
        strip: { recognised: opts.recognisedOrders ?? 0 },
      },
    }),
  };
  const service = new AnalyticsExpensesService(prisma, filters, cache, pnl);
  return { service, prisma, cache, pnl, findMany };
}

const QUERY = {
  preset: 'custom',
  startDate: '2026-09-01',
  endDate: '2026-09-07',
} as any;

function expenseRow(
  amount: number,
  tax: number,
  date: string,
  category = { id: 'c1', name: 'Rent', expenseKind: 'fixed' },
) {
  return {
    amount,
    taxAmount: tax,
    expenseDate: new Date(date),
    category,
  };
}

describe('AnalyticsExpensesService.getSummary', () => {
  it('totals amount + taxAmount with the kind split and recognised revenue refs', async () => {
    const { service } = makeService({
      expenses: [
        expenseRow(1000, 150, '2026-09-02T10:00:00+06:00'),
        expenseRow(200, 0, '2026-09-03T10:00:00+06:00', {
          id: 'c2',
          name: 'Fuel',
          expenseKind: 'variable',
        }),
      ],
      netSales: 10000,
      recognisedOrders: 27,
    });
    const res = await service.getSummary(QUERY);
    expect(res.data.total).toMatchObject({ value: 1350, state: 'ok' });
    expect(res.data.byKind.fixed).toMatchObject({ value: 1150 });
    expect(res.data.byKind.variable).toMatchObject({ value: 200 });
    expect(res.data.byKind.unclassified).toMatchObject({ value: 0 });
    expect(res.data.expenseRevenue.value).toBeCloseTo(0.135);
    expect(res.data.perOrder.value).toBe(50);
    expect(res.data.revenue).toMatchObject({
      netSales: 10000,
      recognisedOrders: 27,
    });
    expect(res.data.meta ?? res.meta).toBeDefined();
  });

  it('withholds expense/revenue (null, never 0) when Net Sales ≤ 0', async () => {
    const { service } = makeService({
      expenses: [expenseRow(100, 0, '2026-09-02T10:00:00+06:00')],
      netSales: 0,
      recognisedOrders: 5,
    });
    const res = await service.getSummary(QUERY);
    expect(res.data.expenseRevenue.value).toBeNull();
    expect(res.data.expenseRevenue.state).not.toBe('ok');
    expect(res.data.perOrder.value).toBe(20);
  });

  it('withholds per-order (null, never 0) when no recognised orders exist', async () => {
    const { service } = makeService({
      expenses: [expenseRow(100, 0, '2026-09-02T10:00:00+06:00')],
      netSales: 10000,
      recognisedOrders: 0,
    });
    const res = await service.getSummary(QUERY);
    expect(res.data.perOrder.value).toBeNull();
    expect(res.data.perOrder.state).not.toBe('ok');
    expect(res.data.expenseRevenue.value).toBeCloseTo(0.01);
  });

  it('reports Budget vs Actual as unavailable with a reason — value null, never zero', async () => {
    const { service } = makeService({
      expenses: [expenseRow(100, 0, '2026-09-02T10:00:00+06:00')],
      netSales: 10000,
      recognisedOrders: 1,
    });
    const res = await service.getSummary(QUERY);
    expect(res.data.budgetVsActual).toMatchObject({
      value: null,
      state: 'unavailable',
    });
    expect(res.data.budgetVsActual.reason).toMatch(/no budget model/i);
  });

  it('reports growth against the previous window with null pct on a zero base', async () => {
    const { service } = makeService({
      expenses: [expenseRow(100, 0, '2026-09-02T10:00:00+06:00')],
      netSales: 10000,
      recognisedOrders: 1,
    });
    const res = await service.getSummary(QUERY);
    expect(res.data.growth.prevTotal).toBe(0);
    expect(res.data.growth.delta).toBe(100);
    expect(res.data.growth.deltaPct).toBeNull();
  });

  it('returns no_data totals when no expenses exist in range', async () => {
    const { service } = makeService({
      expenses: [],
      netSales: 10000,
      recognisedOrders: 1,
    });
    const res = await service.getSummary(QUERY);
    expect(res.data.total).toMatchObject({ value: null, state: 'no_data' });
  });

  it('queries without a trashedAt filter — Expense has no trash field', async () => {
    const { service, findMany } = makeService({
      expenses: [],
      netSales: 0,
      recognisedOrders: 0,
    });
    await service.getSummary(QUERY);
    expect(findMany).toHaveBeenCalled();
    for (const call of findMany.mock.calls) {
      expect(JSON.stringify(call[0]?.where ?? {})).not.toMatch(/trashedAt/);
    }
  });

  it('serves the cached summary without hitting Prisma', async () => {
    const cached = { data: { total: 'cached' }, meta: {} };
    const { service, prisma } = makeService({
      cached,
      netSales: 1,
      recognisedOrders: 1,
    });
    const res = await service.getSummary(QUERY);
    expect(res).toBe(cached);
    expect(prisma.expense.findMany).not.toHaveBeenCalled();
  });
});

describe('AnalyticsExpensesService.getTrend', () => {
  it('buckets the range at day granularity with Dhaka labels', async () => {
    const { service } = makeService({
      expenses: [
        expenseRow(1000, 150, '2026-09-02T10:00:00+06:00'),
        expenseRow(200, 0, '2026-09-02T18:00:00+06:00'),
      ],
    });
    const res = await service.getTrend(QUERY);
    expect(res.data.granularity).toBe('day');
    expect(res.data.points).toHaveLength(7);
    const day2 = res.data.points.find((p: any) => p.label === '2026-09-02');
    expect(day2).toMatchObject({ amount: 1350, expenses: 2 });
    expect(
      res.data.points.reduce((s: number, p: any) => s + p.amount, 0),
    ).toBe(1350);
  });
});

describe('AnalyticsExpensesService.getCategories', () => {
  it('lists every category (zero rows included) with the kind grouping intact', async () => {
    const { service } = makeService({
      expenses: [
        expenseRow(1000, 150, '2026-09-02T10:00:00+06:00'),
      ],
      categories: [
        { id: 'c1', name: 'Rent', expenseKind: 'fixed' },
        { id: 'c2', name: 'Fuel', expenseKind: 'variable' },
      ],
    });
    const res = await service.getCategories(QUERY);
    expect(res.data.total).toBe(2);
    const rent = res.data.rows.find((r: any) => r.categoryId === 'c1');
    const fuel = res.data.rows.find((r: any) => r.categoryId === 'c2');
    expect(rent).toMatchObject({
      name: 'Rent',
      expenseKind: 'fixed',
      total: 1150,
      expenses: 1,
    });
    expect(fuel).toMatchObject({
      name: 'Fuel',
      expenseKind: 'variable',
      total: 0,
      expenses: 0,
    });
  });

  it('narrows by expenseKind without inferring anything', async () => {
    const { service, findMany } = makeService({
      expenses: [],
      categories: [],
    });
    await service.getCategories({ ...QUERY, expenseKind: 'fixed' } as any);
    const where = findMany.mock.calls[0]?.[0]?.where ?? {};
    expect(JSON.stringify(where)).toMatch(/fixed/);
    expect(JSON.stringify(where)).not.toMatch(/trashedAt/);
  });
});

describe('AnalyticsExpensesService.getExpenses (drill list)', () => {
  it('returns row-level expenses with category + kind for the §4.2 drill', async () => {
    const { service, prisma } = makeService({
      expenses: [
        {
          id: 'e1',
          description: 'Office rent',
          amount: 1000,
          taxAmount: 150,
          expenseDate: new Date('2026-09-02T10:00:00+06:00'),
          referenceNo: 'REF-1',
          category: { id: 'c1', name: 'Rent', expenseKind: 'fixed' },
        },
      ],
      expenseCount: 1,
    });
    const res = await service.getExpenses({
      ...QUERY,
      expenseCategoryId: 'c1',
    } as any);
    expect(res.data.total).toBe(1);
    expect(res.data.rows[0]).toMatchObject({
      id: 'e1',
      description: 'Office rent',
      total: 1150,
      category: { id: 'c1', name: 'Rent', expenseKind: 'fixed' },
    });
    expect(prisma.expense.count).toHaveBeenCalled();
  });
});
