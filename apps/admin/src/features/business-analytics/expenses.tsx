'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Area, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Receipt } from 'lucide-react'
import { riseStyle } from '@/components/ui/dashboard'
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
import { AnalyticsPageHeader, EmptyState, InfoDisclosure, MetricMetaFooter } from './components/analytics-ui'
import { KpiCard } from './components/KpiCard'
import { MetricUnavailable } from './components/badges'
import { DrilldownPanel, type DrilldownItem } from './components/DrilldownPanel'
import { buildExpensesQuery } from './api'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')
const RATIO_FORMAT = (v: number) => formatPct(v)

const KIND_BADGE: Record<ExpenseKind, 'info' | 'success' | 'outline'> = {
  fixed: 'info',
  variable: 'success',
  unclassified: 'outline',
}

export const EXPENSES_DRILLDOWN: DrilldownItem[] = [
  { label: 'Expense line → category → expense list', description: 'Category totals down to the booked expense rows', to: '/mon/analytics/expenses', params: { view: 'list' } },
  { label: 'Category → expense module', description: 'Manage categories and their fixed/variable classification', to: '/op/expense-categories' },
  { label: 'Expense/revenue → P&L ladder', description: 'Recognised Net Sales denominator on the Business Overview', to: '/mon/analytics', params: { view: 'ladder' } },
  { label: 'Expense total → reconciliation', description: 'R4 ties the analytics total to Σ Expense.amount + taxAmount', to: '/mon/analytics', params: { view: 'reconciliation' } },
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
  return `/mon/analytics/expenses?${qs}`
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

/**
 * §2.9 overview (W3): total + split + ratios + growth are all KpiCards (one
 * idiom — the hand-rolled growth card is gone). The kind note and the revenue
 * scope live in one disclosure, never captions.
 */
export function ExpensesOverviewCards({ summary, formulaVersion }: { summary: ExpensesSummaryData; formulaVersion?: string }) {
  const growthLabel = `${formatDelta(summary.growth.delta)} (${formatDeltaPct(summary.growth.deltaPct)})`
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-rise" style={riseStyle(0)} data-testid="expenses-overview">
        <KpiCard title="Total expense" kpi={summary.total} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Fixed" kpi={summary.byKind.fixed} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Variable" kpi={summary.byKind.variable} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Unclassified" kpi={summary.byKind.unclassified} formulaVersion={formulaVersion} animate={false} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-rise" style={riseStyle(1)}>
        <KpiCard title="Expense / revenue" kpi={summary.expenseRevenue} format={RATIO_FORMAT} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Expense per order" kpi={summary.perOrder} formulaVersion={formulaVersion} animate={false} />
        <div data-testid="expenses-growth" className="contents">
          <KpiCard
            title="Growth vs previous period"
            kpi={{
              value: summary.growth.delta,
              state: 'ok',
              reason: `${formatDeltaPct(summary.growth.deltaPct)} vs ${formatBDT(summary.growth.prevTotal)} · ${summary.periodDays} day(s)`,
              dateBasis: summary.dateBasis,
            }}
            format={() => growthLabel}
            formulaVersion={formulaVersion}
            animate={false}
          />
        </div>
      </div>
      <InfoDisclosure
        label="About expense kinds and revenue scope"
        lines={[
          summary.kindNote || EXPENSE_KIND_NOTE,
          `Recognised Net Sales ${formatBDT(summary.revenue.netSales)} · ${COUNT_FORMAT(summary.revenue.recognisedOrders)} recognised order(s).`,
          EXPENSE_REVENUE_SCOPE_NOTE,
        ]}
        contentTestId="expenses-scope-notes"
      />
    </div>
  )
}

/**
 * §8.6 — no budget model (W3): a compact unavailable line, never a full card
 * slot and never ৳0.
 */
export function BudgetVsActualCard({ kpi }: { kpi: KpiValue }) {
  return (
    <div data-testid="budget-vs-actual" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm font-medium">Budget vs Actual</span>
      <MetricUnavailable reason={kpi.reason} compact />
      <InfoDisclosure
        label="About Budget vs Actual"
        lines={[BUDGET_VS_ACTUAL_NOTE]}
        contentTestId="budget-note"
        compact
      />
    </div>
  )
}

/**
 * Expense trend on Dhaka buckets at the backend's auto-granularity. Kept as
 * its own chart: the W1 unified TrendChart is net-sales-typed (TrendPoint
 * key + recognised-orders tooltip) and mapping expense points into it would
 * mislabel semantics — the chrome already matches (area + line + tooltip).
 */
export function ExpenseTrendChart({ trend }: { trend: ExpensesTrendData }) {
  return (
    <Card data-testid="expenses-trend" className="chart-card rounded-2xl">
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
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={trend.points} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} className="chart-draw">
              <defs>
                <linearGradient id="expenseTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} minTickGap={24} />
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
              <Area type="monotone" dataKey="amount" fill="url(#expenseTrend)" stroke="none" />
              <Line type="monotone" dataKey="amount" stroke="var(--danger)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

/** Category table with the kind grouping — rows drill to the expense list. */
export function ExpenseCategoryTable({ data }: { data: ExpensesCategoriesData }) {
  return (
    <Card data-testid="expenses-categories" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">By Category</CardTitle>
          <InfoDisclosure
            label="About category basis"
            lines={[data.dateBasis || EXPENSE_DATE_BASIS_STATEMENT]}
            contentTestId="category-basis"
            compact
          />
        </div>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="dash-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Category</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium text-right">Expenses</th>
                  <th className="py-2 pr-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.categoryId} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`category-row-${r.categoryId}`}>
                    <td className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">
                      <a
                        className="underline underline-offset-2"
                        href={expensesListHref(r.categoryId)}
                        data-testid={`category-drill-${r.categoryId}`}
                      >
                        {r.name}
                      </a>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={KIND_BADGE[r.expenseKind]}>
                        {r.expenseKind}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-right">{COUNT_FORMAT(r.expenses)}</td>
                    <td className="py-2 pr-3 tabular-nums font-medium text-right">{formatBDT(r.total)}</td>
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
 * Expense-row drill list (W3): line → category → expense (§4.2). Reference
 * numbers are quiet sublines; the per-row category keeps its kind word as
 * quiet text (never a hover-only title) — the category table above stays the
 * grouped home of that info.
 */
export function ExpenseListTable({ data }: { data: ExpensesListData }) {
  return (
    <Card data-testid="expenses-list" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Expenses</CardTitle>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            incl. tax
            <InfoDisclosure
              label="About expense date basis"
              lines={[data.dateBasis || EXPENSE_DATE_BASIS_STATEMENT]}
              contentTestId="expense-list-basis"
              compact
            />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="dash-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Date</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium text-right">Amount</th>
                  <th className="py-2 pr-3 font-medium text-right">Tax</th>
                  <th className="py-2 pr-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`expense-row-${r.id}`}>
                    <td className="py-2 pr-3 tabular-nums sticky left-0 bg-card z-10">{new Date(r.expenseDate).toLocaleDateString('en-GB')}</td>
                    <td className="py-2 pr-3 font-medium">
                      {r.description}
                      {r.referenceNo ? <span className="block text-[10px] font-normal text-muted-foreground/70">{r.referenceNo}</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant={KIND_BADGE[r.category.expenseKind]} className="text-[10px]">
                          {r.category.name}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{r.category.expenseKind}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-right">{formatBDT(r.amount)}</td>
                    <td className="py-2 pr-3 tabular-nums text-right">{formatBDT(r.taxAmount)}</td>
                    <td className="py-2 pr-3 tabular-nums font-medium text-right">{formatBDT(r.total)}</td>
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
 * list effect lives here (not in the href shape). The focus note names the
 * category from the rows on the page (raw id only as fallback).
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
  const categoryName = categoryId
    ? data.rows.find((r) => r.category.id === categoryId)?.category.name
    : undefined
  const focusNote = `Expenses pre-filtered by drill-down${categoryId ? ` · category ${categoryName ?? categoryId}` : ''}`
  return (
    <section
      ref={sectionRef}
      data-testid="expenses-list-section"
      data-focus={focus ? 'true' : 'false'}
      tabIndex={focus ? 0 : -1}
      aria-label={focus ? 'Expenses (drill-down filtered)' : 'Expenses'}
    >
      {focus ? (
        <p title={focusNote} className="mb-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" data-testid="expenses-list-focus-note">
          {focusNote}
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
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <AnalyticsPageHeader
        icon={Receipt}
        title="Expenses Analytics"
        subtitle={`${EXPENSE_DRILL_LABEL}. ${EXPENSE_DATE_BASIS_STATEMENT}.`}
        tileClassName="bg-danger-soft text-danger border-danger/25"
      />

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Expenses"
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <ExpensesOverviewCards summary={data.data} formulaVersion={data.meta.formulaVersion} />

            <BudgetVsActualCard kpi={data.data.budgetVsActual} />

            {trend.data ? (
              <ExpenseTrendChart trend={trend.data.data} />
            ) : trend.isLoading ? (
              <Skeleton className="h-[250px] w-full rounded-lg" />
            ) : (
              <EmptyState />
            )}

            {categories.data ? (
              <ExpenseCategoryTable data={categories.data.data} />
            ) : categories.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <EmptyState />
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
              <EmptyState />
            )}

            <DrilldownPanel filters={filters} items={EXPENSES_DRILLDOWN} queryBuilder={buildExpensesQuery} />

            <MetricMetaFooter
              formulaVersion={data.meta.formulaVersion}
              dataAsOf={data.meta.dataAsOf}
              dateBasis={data.meta.dateBasis}
              ladderState={data.meta.ladderState}
              periodDays={data.meta.range.periodDays}
            />
          </div>
        ) : isLoading ? (
          <Skeleton className="h-[400px] w-full rounded-lg" />
        ) : (
          <EmptyState />
        )}
      </WidgetShell>
    </div>
  )
}
