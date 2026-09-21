/**
 * Business analytics expenses service (P9, §2.9 + §4.2 expense rows + §8.6).
 *
 * Total Expense = Σ Expense.amount + taxAmount by expenseDate · by
 * ExpenseCategory · Fixed/Variable/Unclassified via the staff-classified
 * ExpenseCategory.expenseKind (default unclassified — never inferred;
 * anything but fixed/variable folds to unclassified) · Expense/Revenue %
 * against recognised Net Sales from the P2 pnl (reused, never recomputed;
 * null when NS ≤ 0 — never 0%) · Expense per Order over recognised orders
 * (null when 0) · Dhaka-bucket trend + previous-window growth · Budget vs
 * Actual is unavailable (no budget model exists — never zero).
 *
 * Expense has no trash field, so no trashedAt filter exists or is needed.
 * Totals reuse the P2 summariseExpenses rollup (R4 ties to it by
 * construction). Cache TTL is 60s live / 15min closed via
 * analyticsCacheTtlMs, like every sibling service.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  AnalyticsFilterService,
  type ResolvedAnalyticsContext,
} from './analytics-filter.service';
import {
  AnalyticsPnlService,
  summariseExpenses,
} from './analytics-pnl.service';
import {
  bucketEdges,
  fittingGranularity,
} from './analytics-overview.service';
import type { ExpensesQueryDto } from './analytics-expenses.dto';
import { expensesPagination } from './analytics-expenses.dto';
import {
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  kpiOk,
  kpiZero,
  kpiNoData,
  kpiUnavailable,
  type KpiValue,
  type AnalyticsMeta,
} from './analytics-envelope.util';
import type { Granularity } from './analytics-range.util';

// ---------------------------------------------------------------------------
// Verbatim disclosure strings (mirrored by the admin expenses page).
// ---------------------------------------------------------------------------

/** §2.9 kind policy — the split is staff-classified, never derived. */
export const EXPENSE_KIND_NOTE =
  'Fixed / Variable / Unclassified comes from the staff-classified ' +
  'ExpenseCategory.expenseKind (default unclassified) — never inferred. ' +
  'Unknown values fold to unclassified.';

/** §2.3 date basis — amount + tax by the expense date. */
export const EXPENSE_DATE_BASIS =
  'Σ Expense.amount + taxAmount by Expense.expenseDate (Dhaka day-inclusive)';

/** §8.6 — no budget model exists, so the comparison is unavailable, never zero. */
export const BUDGET_VS_ACTUAL_REASON =
  'No budget model exists — Budget vs Actual is unavailable for every ' +
  'period, never zero.';

/** §4.2 drill path for the expenses page. */
export const EXPENSE_DRILL_LABEL =
  'Expense line → Expenses → category → expense list';

/** Trend honesty bound (same policy as the overview/sales trends). */
export const EXPENSES_TREND_BUCKET_CAP = 366;

// ---------------------------------------------------------------------------
// Pure expense math (unit-tested, no DB).
// ---------------------------------------------------------------------------

/** Staff-classified kind — anything but fixed/variable is unclassified. */
export type ExpenseKind = 'fixed' | 'variable' | 'unclassified';

export function classifyExpenseKind(kind: unknown): ExpenseKind {
  return kind === 'fixed' || kind === 'variable' ? kind : 'unclassified';
}

export interface ExpenseRowInput {
  amount: number;
  taxAmount: number;
  expenseDate: Date;
}

/** Expense/Revenue ratio. Null when Net Sales ≤ 0 or missing — never 0, never Infinity. */
export function computeExpenseRevenuePct(
  total: number,
  netSales: number | null | undefined,
): number | null {
  if (netSales === null || netSales === undefined) return null;
  if (!Number.isFinite(netSales) || netSales <= 0) return null;
  if (!Number.isFinite(total)) return null;
  return total / netSales;
}

/** Expense per recognised order. Null when the cohort is empty — never 0. */
export function computeExpensePerOrder(
  total: number,
  recognisedOrders: number,
): number | null {
  if (!Number.isFinite(recognisedOrders) || recognisedOrders <= 0) return null;
  if (!Number.isFinite(total)) return null;
  return total / recognisedOrders;
}

/** Growth against the previous window. Pct stays null on a zero base — never 0%/Infinity. */
export function computeExpenseGrowth(
  current: number,
  previous: number,
): { delta: number; deltaPct: number | null } {
  const delta = current - previous;
  return {
    delta,
    deltaPct: previous !== 0 ? (delta / Math.abs(previous)) * 100 : null,
  };
}

export interface ExpenseBucketEdge {
  start: Date;
  end: Date;
  label: string;
}

export interface ExpenseTrendPoint {
  bucketStart: string;
  label: string;
  amount: number;
  expenses: number;
}

/** Σ amount + taxAmount per Dhaka bucket edge (out-of-edge rows ignored). */
export function bucketExpenseTrend(
  rows: ExpenseRowInput[],
  edges: ExpenseBucketEdge[],
): ExpenseTrendPoint[] {
  return edges.map((edge) => {
    let amount = 0;
    let expenses = 0;
    for (const r of rows) {
      if (r.expenseDate >= edge.start && r.expenseDate <= edge.end) {
        amount += r.amount + r.taxAmount;
        expenses += 1;
      }
    }
    return {
      bucketStart: edge.start.toISOString(),
      label: edge.label,
      amount,
      expenses,
    };
  });
}

// ---------------------------------------------------------------------------
// Response shapes.
// ---------------------------------------------------------------------------

export interface ExpenseCategoryRow {
  categoryId: string;
  name: string;
  expenseKind: ExpenseKind;
  total: number;
  expenses: number;
}

export interface ExpenseListRow {
  id: string;
  description: string;
  amount: number;
  taxAmount: number;
  total: number;
  expenseDate: string;
  referenceNo: string | null;
  category: { id: string; name: string; expenseKind: ExpenseKind };
}

export interface ExpensesSummaryData {
  periodDays: number;
  total: KpiValue;
  byKind: { fixed: KpiValue; variable: KpiValue; unclassified: KpiValue };
  kindNote: string;
  /** Ratio against recognised Net Sales — null unless NS > 0. */
  expenseRevenue: KpiValue;
  /** Total over recognised orders — null unless the cohort is non-empty. */
  perOrder: KpiValue;
  revenue: {
    netSales: number;
    recognisedOrders: number;
    dateBasis: string;
  };
  growth: {
    prevTotal: number;
    delta: number;
    deltaPct: number | null;
    comparison: { prevStart: string; prevEnd: string };
  };
  /** Always unavailable — no budget model (§8.6). */
  budgetVsActual: KpiValue;
  dateBasis: string;
}

export interface ExpensesTrendData {
  periodDays: number;
  requestedGranularity: Granularity;
  granularity: Granularity;
  points: ExpenseTrendPoint[];
  dateBasis: string;
}

export interface ExpensesCategoriesData {
  periodDays: number;
  rows: ExpenseCategoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  dateBasis: string;
}

export interface ExpensesListData {
  periodDays: number;
  rows: ExpenseListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  dateBasis: string;
}

const REVENUE_DATE_BASIS =
  'Delivered transition — the P&L basis (recognised Net Sales + recognised ' +
  'orders reused from the P2 ladder, never recomputed). Order dimensions in ' +
  'the filter shape the revenue denominator; expense lines stay ' +
  'company-wide by expenseDate.';

@Injectable()
export class AnalyticsExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filters: AnalyticsFilterService,
    private readonly cache: CacheService,
    private readonly pnl: AnalyticsPnlService,
  ) {}

  private respond<T>(
    data: T,
    ctx: ResolvedAnalyticsContext,
    coverage: Record<string, unknown>,
  ): { data: T; meta: AnalyticsMeta } {
    return {
      data,
      meta: buildMeta(ctx, ctx.filters, {
        recognition: 'delivered-only',
        costCoverage: { expenses: coverage },
        // Operating Expenses is the always-actual ladder line (§2.3).
        ladderState: 'actual',
        thresholds: { budgetVsActual: 'unavailable', trendBucketCap: EXPENSES_TREND_BUCKET_CAP },
        dateBasis: `${EXPENSE_DATE_BASIS} · revenue ${REVENUE_DATE_BASIS}`,
      }),
    };
  }

  private async cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMs);
    } catch {
      /* computed response is served regardless */
    }
  }

  /**
   * Expense narrow shared by every endpoint. Expense has no trashedAt — no
   * trash filter exists or is needed. Kind narrows through the category
   * relation (staff-classified, never inferred).
   */
  private narrowWhere(
    query: ExpensesQueryDto,
  ): Record<string, unknown> {
    const where: any = {};
    if (query.expenseCategoryId) where.categoryId = query.expenseCategoryId;
    if (query.expenseKind || query.search) {
      where.category = {
        ...(query.expenseKind ? { expenseKind: query.expenseKind } : {}),
      };
    }
    if (query.search) {
      where.description = { contains: query.search, mode: 'insensitive' };
    }
    return where;
  }

  private toSummaryRows(rows: any[]): {
    amount: number;
    taxAmount: number;
    expenseDate: Date;
    category: { id: string; name: string; expenseKind: string };
  }[] {
    return (rows ?? []).map((r: any) => ({
      amount: Number(r.amount),
      taxAmount: Number(r.taxAmount),
      expenseDate: new Date(r.expenseDate),
      category: {
        id: r.category.id,
        name: r.category.name,
        expenseKind: r.category.expenseKind,
      },
    }));
  }

  /** Expense overview: total + kind split + ratios + growth + budget honesty (financial). */
  async getSummary(query: ExpensesQueryDto) {
    const key = analyticsCacheKey('expenses/summary', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;

    // One round-trip for current + previous windows (prevStart → end), so
    // growth foots from a single fetch; revenue reuses the cached P2 ladder.
    const [rows, pnl] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          ...this.narrowWhere(query),
          expenseDate: { gte: range.comparison.prevStart, lte: range.end },
        },
        select: {
          amount: true,
          taxAmount: true,
          expenseDate: true,
          category: { select: { id: true, name: true, expenseKind: true } },
        },
      }),
      this.pnl.getPnl(query),
    ]);

    const summary = summariseExpenses(this.toSummaryRows(rows as any[]), range);
    const prev = summariseExpenses(this.toSummaryRows(rows as any[]), {
      start: range.comparison.prevStart,
      end: range.comparison.prevEnd,
    });
    const growth = computeExpenseGrowth(summary.total, prev.total);

    const netSales = pnl.data.lines.netSales.value ?? 0;
    const recognisedOrders = pnl.data.strip.recognised ?? 0;
    const revenuePct = computeExpenseRevenuePct(summary.total, netSales);
    const perOrder = computeExpensePerOrder(summary.total, recognisedOrders);

    const money = (v: number, empty: boolean): KpiValue =>
      empty
        ? kpiNoData('no expenses in range')
        : v === 0
          ? kpiZero('measured zero — expenses net to ৳0')
          : kpiOk(v, { dateBasis: EXPENSE_DATE_BASIS });
    const empty = summary.total === 0 && (rows as any[]).length === 0;

    const data: ExpensesSummaryData = {
      periodDays: range.periodDays,
      total: money(summary.total, empty),
      byKind: {
        fixed: money(summary.byKind.fixed, empty),
        variable: money(summary.byKind.variable, empty),
        unclassified: money(summary.byKind.unclassified, empty),
      },
      kindNote: EXPENSE_KIND_NOTE,
      expenseRevenue:
        revenuePct === null
          ? kpiUnavailable(
              'Net Sales ≤ 0 (or missing) in range — expense/revenue withheld, never zero-filled',
            )
          : kpiOk(revenuePct, {
              dateBasis: `expenses by ${EXPENSE_DATE_BASIS} ÷ recognised Net Sales (${REVENUE_DATE_BASIS})`,
            }),
      perOrder:
        perOrder === null
          ? kpiUnavailable(
              'no recognised orders in range — expense per order withheld, never zero-filled',
            )
          : kpiOk(perOrder, {
              dateBasis: `expenses by ${EXPENSE_DATE_BASIS} ÷ recognised orders (${REVENUE_DATE_BASIS})`,
            }),
      revenue: {
        netSales,
        recognisedOrders,
        dateBasis: REVENUE_DATE_BASIS,
      },
      growth: {
        prevTotal: prev.total,
        delta: growth.delta,
        deltaPct: growth.deltaPct,
        comparison: {
          prevStart: range.comparison.prevStart.toISOString(),
          prevEnd: range.comparison.prevEnd.toISOString(),
        },
      },
      budgetVsActual: kpiUnavailable(BUDGET_VS_ACTUAL_REASON),
      dateBasis: EXPENSE_DATE_BASIS,
    };
    const response = this.respond(data, ctx, {
      total: summary.total,
      categories: summary.byCategory.length,
      recognisedOrders,
    });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Expense trend on Dhaka buckets at the requested (fitted) granularity (financial). */
  async getTrend(query: ExpensesQueryDto) {
    const key = analyticsCacheKey('expenses/trend', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const granularity = query.granularity ?? range.granularity;
    const effectiveGranularity = fittingGranularity(
      range.start,
      range.end,
      granularity,
    );

    const rows: any[] = await this.prisma.expense.findMany({
      where: {
        ...this.narrowWhere(query),
        expenseDate: { gte: range.start, lte: range.end },
      },
      select: { amount: true, taxAmount: true, expenseDate: true },
    });
    const points = bucketExpenseTrend(
      rows.map((r: any) => ({
        amount: Number(r.amount),
        taxAmount: Number(r.taxAmount),
        expenseDate: new Date(r.expenseDate),
      })),
      bucketEdges(range.start, range.end, effectiveGranularity),
    );

    const data: ExpensesTrendData = {
      periodDays: range.periodDays,
      requestedGranularity: granularity,
      granularity: effectiveGranularity,
      points,
      dateBasis: EXPENSE_DATE_BASIS,
    };
    const response = this.respond(data, ctx, {
      expenses: (rows as any[]).length,
    });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Category table: every category (zero rows included) with kind + totals (financial). */
  async getCategories(query: ExpensesQueryDto) {
    const key = analyticsCacheKey('expenses/categories', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const { page, pageSize } = expensesPagination(query);

    const [categories, rows] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where: {
          ...(query.expenseCategoryId ? { id: query.expenseCategoryId } : {}),
          ...(query.expenseKind ? { expenseKind: query.expenseKind } : {}),
          ...(query.search
            ? { name: { contains: query.search, mode: 'insensitive' } }
            : {}),
        },
        select: { id: true, name: true, expenseKind: true },
      }),
      this.prisma.expense.findMany({
        where: {
          ...this.narrowWhere(query),
          expenseDate: { gte: range.start, lte: range.end },
        },
        select: {
          amount: true,
          taxAmount: true,
          expenseDate: true,
          category: { select: { id: true, name: true, expenseKind: true } },
        },
      }),
    ]);

    const summary = summariseExpenses(this.toSummaryRows(rows as any[]), range);
    const byId = new Map(summary.byCategory.map((c) => [c.categoryId, c]));
    const counts = new Map<string, number>();
    for (const r of (rows as any[])) {
      const id = r.category.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    let table: ExpenseCategoryRow[] = (categories as any[]).map((c: any) => {
      const agg = byId.get(c.id);
      return {
        categoryId: c.id,
        name: c.name,
        expenseKind: classifyExpenseKind(c.expenseKind),
        total: agg?.total ?? 0,
        expenses: counts.get(c.id) ?? 0,
      };
    });
    // Categories created mid-range may hold expenses while the category read
    // above resolves concurrently — fold any such row in rather than dropping.
    for (const c of summary.byCategory) {
      if (!table.some((t) => t.categoryId === c.categoryId)) {
        table.push({
          categoryId: c.categoryId,
          name: c.name,
          expenseKind: classifyExpenseKind(c.expenseKind),
          total: c.total,
          expenses: counts.get(c.categoryId) ?? 0,
        });
      }
    }

    const sort = query.sort ?? 'total';
    const dir = query.dir === 'asc' ? 1 : -1;
    table.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name) * dir;
      return (a.total - b.total) * dir;
    });

    const total = table.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data: ExpensesCategoriesData = {
      periodDays: range.periodDays,
      rows: table.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
      totalPages,
      dateBasis: EXPENSE_DATE_BASIS,
    };
    const response = this.respond(data, ctx, {
      categories: total,
      total: summary.total,
    });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }

  /** Expense-row drill list: line → category → expense (§4.2, financial). */
  async getExpenses(query: ExpensesQueryDto) {
    const key = analyticsCacheKey('expenses/list', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const ctx = this.filters.resolveContext(query);
    const { range } = ctx;
    const { page, pageSize } = expensesPagination(query);

    const where: any = {
      ...this.narrowWhere(query),
      expenseDate: { gte: range.start, lte: range.end },
    };
    if (query.expenseKind) {
      // Kind lives on the category — narrow through the relation.
      where.category = { ...(where.category ?? {}), expenseKind: query.expenseKind };
    }
    const sort = query.sort ?? 'expenseDate';
    const dir = query.dir ?? 'desc';

    const [total, rows] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        select: {
          id: true,
          description: true,
          amount: true,
          taxAmount: true,
          expenseDate: true,
          referenceNo: true,
          category: { select: { id: true, name: true, expenseKind: true } },
        },
        orderBy:
          sort === 'total'
            ? { amount: dir as 'asc' | 'desc' }
            : sort === 'name'
              ? { description: dir as 'asc' | 'desc' }
              : { expenseDate: dir as 'asc' | 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data: ExpensesListData = {
      periodDays: range.periodDays,
      rows: (rows as any[]).map((r: any) => ({
        id: r.id,
        description: r.description,
        amount: Number(r.amount),
        taxAmount: Number(r.taxAmount),
        total: Number(r.amount) + Number(r.taxAmount),
        expenseDate: new Date(r.expenseDate).toISOString(),
        referenceNo: r.referenceNo ?? null,
        category: {
          id: r.category.id,
          name: r.category.name,
          expenseKind: classifyExpenseKind(r.category.expenseKind),
        },
      })),
      total,
      page,
      pageSize,
      totalPages,
      dateBasis: EXPENSE_DATE_BASIS,
    };
    const response = this.respond(data, ctx, { rows: total });
    await this.cacheSet(key, response, analyticsCacheTtlMs(ctx.range));
    return response;
  }
}
