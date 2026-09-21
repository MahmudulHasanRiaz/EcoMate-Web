'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import {
  useExpensesCategories,
  useExpensesList,
  useExpensesSummary,
  useExpensesTrend,
} from './hooks'
import {
  BUDGET_VS_ACTUAL_NOTE,
  DEFAULT_FILTERS,
  EXPENSE_DATE_BASIS_STATEMENT,
  EXPENSE_DRILL_LABEL,
  EXPENSE_KIND_NOTE,
  EXPENSE_REVENUE_SCOPE_NOTE,
  formatBDT,
  formatDelta,
  formatDeltaPct,
  formatPct,
  type AnalyticsFilters,
  type ExpenseAnalyticsFilters,
  type ExpenseKind,
  type ExpensesCategoriesData,
  type ExpensesListData,
  type ExpensesSummaryData,
  type ExpensesTrendData,
  type KpiValue,
} from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { KpiCard } from './components/KpiCard'
import { DrilldownPanel, type DrilldownItem } from './components/DrilldownPanel'
import { buildExpensesQuery } from './api'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')
const RATIO_FORMAT = (v: number) => formatPct(v)

const KIND_BADGE: Record<ExpenseKind, string> = {
  fixed: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
  variable: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  unclassified: 'bg-muted text-muted-foreground border-border',
}

const EXPENSES_DRILLDOWN: DrilldownItem[] = [
  { label: 'Expense line → category → expense list', description: 'Category totals down to the booked expense rows', to: '/op/analytics/expenses', params: { view: 'list' } },
  { label: 'Category → expense module', description: 'Manage categories and their fixed/variable classification', to: '/op/expense-categories' },
  { label: 'Expense/revenue → P&L ladder', description: 'Recognised Net Sales denominator on the Business Overview', to: '/op/analytics/overview', params: { view: 'ladder' } },
  { label: 'Expense total → reconciliation', description: 'R4 ties the analytics total to Σ Expense.amount + taxAmount', to: '/op/analytics/overview', params: { view: 'reconciliation' } },
]

/** Router search params for the §4.2 expenses drill landing (query objects). */
export interface ExpensesDrillSearch {
  view?: string
  categoryId?: string
}

/**
 * Resolve the drill landing: view=list — or a bare categoryId — focuses the
 * expense-list section pre-filtered by categoryId. Pure so the params →
 * filtered-list effect is unit-testable.
 */
export function resolveExpensesDrill(search: ExpensesDrillSearch | undefined): {
  focusList: boolean
  categoryId?: string
} {
  const categoryId = search?.categoryId || undefined
  const focusList = search?.view === 'list' || categoryId !== undefined
  return { focusList, categoryId }
}

/** Drill href built from query objects — the landing above honours it. */
export function expensesListHref(categoryId: string): string {
  const qs = new URLSearchParams({ view: 'list', categoryId }).toString()
  return `/op/analytics/expenses?${qs}`
}

/** Falls back to the live URL when no router search is passed (plain <a> landings). */
export function readExpensesDrillSearch(): ExpensesDrillSearch {
  if (typeof window === 'undefined') return {}
  const qs = new URLSearchParams(window.location.search)
  return {
    view: qs.get('view') ?? undefined,
    categoryId: qs.get('categoryId') ?? undefined,
  }
}

/** §2.9 overview: total + fixed/variable/unclassified split + ratios + growth. */
export function ExpensesOverviewCards({ summary }: { summary: ExpensesSummaryData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="expenses-overview">
        <KpiCard title="Total expense" kpi={summary.total} />
        <KpiCard title="Fixed" kpi={summary.byKind.fixed} />
        <KpiCard title="Variable" kpi={summary.byKind.variable} />
        <KpiCard title="Unclassified" kpi={summary.byKind.unclassified} />
      </div>
      <p className="text-[11px] text-muted-foreground" data-testid="kind-note">
        {summary.kindNote || EXPENSE_KIND_NOTE}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard title="Expense / revenue" kpi={summary.expenseRevenue} format={RATIO_FORMAT} />
        <KpiCard title="Expense per order" kpi={summary.perOrder} />
        <Card data-testid="expenses-growth">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Growth vs previous period</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatDelta(summary.growth.delta)}</p>
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
              {formatDeltaPct(summary.growth.deltaPct)} vs {formatBDT(summary.growth.prevTotal)} ·{' '}
              {summary.periodDays} day(s)
            </p>
          </CardContent>
        </Card>
      </div>
      <p className="text-[11px] text-muted-foreground tabular-nums" data-testid="revenue-scope">
        Recognised Net Sales {formatBDT(summary.revenue.netSales)} · {COUNT_FORMAT(summary.revenue.recognisedOrders)} recognised order(s).{' '}
        {EXPENSE_REVENUE_SCOPE_NOTE}
      </p>
    </div>
  )
}

/** §8.6 — no budget model: the card renders Unavailable, never ৳0. */
export function BudgetVsActualCard({ kpi }: { kpi: KpiValue }) {
  return (
    <Card data-testid="budget-vs-actual">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Budget vs Actual</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <KpiCard title="Budget variance" kpi={kpi} />
        <p className="text-[11px] text-muted-foreground">{BUDGET_VS_ACTUAL_NOTE}</p>
      </CardContent>
    </Card>
  )
}

/** Expense trend on Dhaka buckets at the backend's auto-granularity. */
export function ExpenseTrendChart({ trend }: { trend: ExpensesTrendData }) {
  return (
    <Card data-testid="expenses-trend">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Expense Trend</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Auto-granularity: {trend.granularity}
          {trend.granularity !== trend.requestedGranularity ? ` (requested ${trend.requestedGranularity}, stepped up past the bucket cap)` : ''} ·{' '}
          {trend.dateBasis || EXPENSE_DATE_BASIS_STATEMENT}
        </p>
      </CardHeader>
      <CardContent>
        {trend.points.length === 0 ? (
          <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trend.points} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(156,163,175,0.1)" />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} />
              <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} dx={-5} />
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (active && payload?.length) {
                    return (
                      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
                        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
                        <p className="text-sm font-bold text-foreground mt-0.5">৳{Number(payload[0].value).toLocaleString()}</p>
                        {payload[0].payload ? (
                          <p className="text-[11px] text-muted-foreground">{payload[0].payload.expenses} expense(s)</p>
                        ) : null}
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Line type="monotone" dataKey="amount" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

/** Category table with the kind grouping — rows drill to the expense list. */
export function ExpenseCategoryTable({ data }: { data: ExpensesCategoriesData }) {
  return (
    <Card data-testid="expenses-categories">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">By Category</CardTitle>
        <p className="text-[11px] text-muted-foreground">{data.dateBasis || EXPENSE_DATE_BASIS_STATEMENT}</p>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Expenses</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.categoryId} className="border-t border-border/50" data-testid={`category-row-${r.categoryId}`}>
                    <td className="py-2 pr-3 font-medium">
                      <a
                        className="underline underline-offset-2"
                        href={expensesListHref(r.categoryId)}
                        data-testid={`category-drill-${r.categoryId}`}
                      >
                        {r.name}
                      </a>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={KIND_BADGE[r.expenseKind]}>
                        {r.expenseKind}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{COUNT_FORMAT(r.expenses)}</td>
                    <td className="py-2 pr-3 tabular-nums font-medium">{formatBDT(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Page {data.page} of {data.totalPages} · {data.total} row(s)
        </p>
      </CardContent>
    </Card>
  )
}

/** Expense-row drill list: line → category → expense (§4.2). */
export function ExpenseListTable({ data }: { data: ExpensesListData }) {
  return (
    <Card data-testid="expenses-list">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Expenses</CardTitle>
        <p className="text-[11px] text-muted-foreground">{data.dateBasis || EXPENSE_DATE_BASIS_STATEMENT} · incl. tax</p>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Tax</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50" data-testid={`expense-row-${r.id}`}>
                    <td className="py-2 pr-3 tabular-nums">{new Date(r.expenseDate).toLocaleDateString('en-GB')}</td>
                    <td className="py-2 pr-3 font-medium">
                      {r.description}
                      {r.referenceNo ? <span className="block text-[11px] text-muted-foreground">{r.referenceNo}</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={KIND_BADGE[r.category.expenseKind]} title={r.category.expenseKind}>
                        {r.category.name}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatBDT(r.amount)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatBDT(r.taxAmount)}</td>
                    <td className="py-2 pr-3 tabular-nums font-medium">{formatBDT(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Page {data.page} of {data.totalPages} · {data.total} row(s)
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * List section: when a drill landing focuses it, the section is marked,
 * announced, and pre-filtered by the drill category — the params → filtered
 * list effect lives here (not in the href shape).
 */
export function ExpensesListSection({
  data,
  focus,
  categoryId,
  sectionRef,
}: {
  data: ExpensesListData
  focus: boolean
  categoryId?: string
  sectionRef?: Ref<HTMLElement>
}) {
  return (
    <section
      ref={sectionRef}
      data-testid="expenses-list-section"
      data-focus={focus ? 'true' : 'false'}
      tabIndex={focus ? 0 : -1}
      aria-label={focus ? 'Expenses (drill-down filtered)' : 'Expenses'}
    >
      {focus ? (
        <p className="mb-2 text-xs text-muted-foreground" data-testid="expenses-list-focus-note">
          Expenses pre-filtered by drill-down
          {categoryId ? ` · category ${categoryId}` : ''}
        </p>
      ) : null}
      <ExpenseListTable data={data} />
    </section>
  )
}

/**
 * Expenses Analytics (P9, §2.9): total + fixed/variable/unclassified split +
 * trend + growth + expense/revenue + expense per order; Budget vs Actual
 * unavailable (§8.6); drill-down line → category → expense list (§4.2).
 *
 * Drill landing: ?view=list&categoryId= (router search, or the live URL
 * fallback) focuses the expense-list section pre-filtered by the drill
 * category — every list request carries the narrow via buildExpensesQuery.
 */
export default function ExpensesAnalytics({ initialSearch }: { initialSearch?: ExpensesDrillSearch } = {}) {
  const [drill] = useState(() => resolveExpensesDrill(initialSearch ?? readExpensesDrillSearch()))
  const [filters, setFilters] = useState<ExpenseAnalyticsFilters>(() => ({
    ...DEFAULT_FILTERS,
    ...(drill.categoryId ? { expenseCategoryId: drill.categoryId } : {}),
  }))
  const [page, setPage] = useState(1)
  const pageSize = 20
  const listRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (drill.focusList) {
      listRef.current?.focus?.()
      listRef.current?.scrollIntoView?.({ block: 'start' })
    }
  }, [drill.focusList])
  const { data, isLoading, error, refetch } = useExpensesSummary(filters)
  const trend = useExpensesTrend(filters)
  const categories = useExpensesCategories(filters, page, pageSize)
  const list = useExpensesList(filters, page, pageSize)

  const onFilters = (n: AnalyticsFilters) => {
    setFilters(n as ExpenseAnalyticsFilters)
    setPage(1)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Expenses Analytics</h1>
          <p className="text-xs text-muted-foreground">{EXPENSE_DRILL_LABEL}. {EXPENSE_DATE_BASIS_STATEMENT}.</p>
        </div>
      </div>

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Expenses"
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <ExpensesOverviewCards summary={data.data} />

            <BudgetVsActualCard kpi={data.data.budgetVsActual} />

            {trend.data ? (
              <ExpenseTrendChart trend={trend.data.data} />
            ) : trend.isLoading ? (
              <Skeleton className="h-[250px] w-full rounded-lg" />
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
            )}

            {categories.data ? (
              <ExpenseCategoryTable data={categories.data.data} />
            ) : categories.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
            )}

            {list.data ? (
              <ExpensesListSection
                data={list.data.data}
                focus={drill.focusList}
                categoryId={drill.categoryId}
                sectionRef={listRef}
              />
            ) : list.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
            )}

            <DrilldownPanel filters={filters} items={EXPENSES_DRILLDOWN} queryBuilder={buildExpensesQuery} />

            <p className="text-[11px] text-muted-foreground">
              Formula {data.meta.formulaVersion} · Data as of {data.meta.dataAsOf} · {data.meta.dateBasis} · Period {data.meta.range.periodDays} day(s)
            </p>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-[400px] w-full rounded-lg" />
        ) : (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        )}
      </WidgetShell>
    </div>
  )
}
