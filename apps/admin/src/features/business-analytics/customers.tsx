'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TriangleAlert, Users } from 'lucide-react'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { StatusBadge, riseStyle, type StatusTone } from '@/components/ui/dashboard'
import { useCustomerCohorts, useCustomersList, useCustomersSummary } from './hooks'
import {
  CLR_STATEMENT,
  DEFAULT_FILTERS,
  UNATTRIBUTED_STATEMENT,
  formatBDT,
  formatPct,
  type AnalyticsFilters,
  type CustomerCohort,
  type CustomerSegmentLabel,
  type CustomerUnattributed,
} from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { KpiCard } from './components/KpiCard'
import { DrilldownPanel, type DrilldownItem } from './components/DrilldownPanel'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')

const CUSTOMER_DRILLDOWN: DrilldownItem[] = [
  { label: 'New segment → customers → order history', description: 'First-ever recognised in range, down to contributing orders', to: '/mon/analytics/customers', params: { segment: 'new' } },
  { label: 'Returning segment → customers → order history', description: 'Recognised before the range, down to contributing orders', to: '/mon/analytics/customers', params: { segment: 'returning' } },
  { label: 'VIP segment → customers → order history', description: 'Returning plus ≥5 lifetime recognised orders (default policy)', to: '/mon/analytics/customers', params: { segment: 'vip' } },
  { label: 'Customer → order history', description: 'Profile customers open their record; guests open phone-filtered orders', to: '/op/customers' },
  { label: 'Unattributed → phone-less guest orders', description: 'Orders that cannot be linked — fix by capturing a phone', to: '/op/orders' },
]

/** W9/limitation-12 disclosure: phone-less guests are counted singly, never merged. */
export function UnattributedBanner({ unattributed }: { unattributed: CustomerUnattributed }) {
  if (unattributed.orders === 0) return null
  return (
    <Card className="chart-card rounded-2xl border-warning/30 bg-warning-soft" data-testid="unattributed-banner">
      <CardContent className="pt-4 flex items-start gap-3">
        <TriangleAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">
            {unattributed.orders} unattributed order(s) · {unattributed.customers} unattributed customer(s) ·{' '}
            {formatBDT(unattributed.revenue)} unattributed revenue
          </p>
          <p className="text-xs text-muted-foreground mt-1">{unattributed.statement || UNATTRIBUTED_STATEMENT}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** Cohort heatmap-lite: acquisition month rows × window-month retention cells. */
export function CohortTable({ cohorts, months }: { cohorts: CustomerCohort[]; months: string[] }) {
  return (
    <div className="overflow-x-auto" data-testid="cohort-table">
      <table className="dash-table w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Acquired</th>
            <th className="py-2 pr-3 font-medium">Customers</th>
            {months.map((m) => (
              <th key={m} className="py-2 pr-3 font-medium">{m}</th>
            ))}
            <th className="py-2 pr-3 font-medium">Cumulative CLR</th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.acquisitionMonth} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`cohort-row-${c.acquisitionMonth}`}>
              <td className="py-2 pr-3 font-medium">{c.acquisitionMonth}</td>
              <td className="py-2 pr-3 tabular-nums">{c.size}</td>
              {months.map((m) => {
                const cell = c.retention.find((r) => r.month === m)
                if (!cell) return <td key={m} className="py-2 pr-3 text-muted-foreground/40">—</td>
                const intensity = cell.rate === null ? 0 : cell.rate
                return (
                  <td key={m} className="py-2 pr-3">
                    <span
                      className="inline-block rounded px-2 py-0.5 tabular-nums bg-success-soft text-success border border-success/25"
                      style={{ opacity: (0.55 + intensity * 0.45).toFixed(2) }}
                      title={`${cell.active}/${c.size} active in ${m}`}
                    >
                      {formatPct(cell.rate)}
                    </span>
                  </td>
                )
              })}
              <td className="py-2 pr-3 tabular-nums font-medium">{formatBDT(c.cumulativeClr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SEGMENT_TONE: Record<string, StatusTone> = {
  new: 'info',
  returning: 'cyan',
  vip: 'pink',
}

function customerHistoryHref(row: { kind: 'profile' | 'guest'; profileId: string | null; phone: string | null }): string {
  if (row.kind === 'profile' && row.profileId) return `/op/customers/${row.profileId}`
  if (row.phone) return `/op/orders?search=${encodeURIComponent(row.phone)}`
  return '/op/orders'
}

/**
 * Customer Analytics (P6, §2.7): acquisition (new vs returning), repeat
 * rate, per-customer value, observed CLR (never a prediction), cohort
 * retention × cumulative CLR (stated insufficient_history under two months),
 * unattributed disclosure, and the §4.2 drill (segment → customer → order
 * history). Recognised orders only — Delivered is the recognition event.
 */
export default function CustomerAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [segment, setSegment] = useState<string>('')
  const pageSize = 20
  const { data, isLoading, error, refetch } = useCustomersSummary(filters)
  const cohorts = useCustomerCohorts(filters)
  const list = useCustomersList(filters, page, pageSize, segment || undefined)

  const onFilters = (n: AnalyticsFilters) => {
    setFilters(n)
    setPage(1)
  }
  const onSegment = (s: string) => {
    setSegment(s === 'all' ? '' : s)
    setPage(1)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="chart-card-header-icon bg-accent-cyan-soft text-accent-cyan border border-accent-cyan/25">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Customer Analytics</h1>
            <p className="text-xs text-muted-foreground">Recognised customers only — Delivered is the recognition event. CLR is observed revenue, never a prediction.</p>
          </div>
        </div>
      </div>

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Customers"
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)} data-testid="acquisition-band">
              <KpiCard title="New Customers" kpi={data.data.acquisition.newCustomers} format={COUNT_FORMAT} formulaVersion={data.meta.formulaVersion} drilldownHref="/mon/analytics/customers?segment=new" />
              <KpiCard title="Returning Customers" kpi={data.data.acquisition.returningCustomers} format={COUNT_FORMAT} formulaVersion={data.meta.formulaVersion} drilldownHref="/mon/analytics/customers?segment=returning" />
              <KpiCard title="Total Customers" kpi={data.data.acquisition.totalCustomers} format={COUNT_FORMAT} formulaVersion={data.meta.formulaVersion} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-rise" style={riseStyle(1)}>
              <KpiCard title="Repeat Purchase Rate" kpi={data.data.repeat.rate} format={(v) => formatPct(v)} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Revenue per Customer" kpi={data.data.value.revenuePerCustomer} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Orders per Customer" kpi={data.data.value.ordersPerCustomer} format={COUNT_FORMAT} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Avg Customer Order Value" kpi={data.data.value.averageCustomerOrderValue} formulaVersion={data.meta.formulaVersion} />
            </div>

            <Card data-testid="clr-card" className="chart-card rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Customer Lifetime Revenue (observed)</CardTitle>
              </CardHeader>
              <CardContent>
                <KpiCard title="Cumulative CLR" kpi={data.data.clr.total} formulaVersion={data.meta.formulaVersion} />
                <p className="text-[11px] text-muted-foreground mt-2">{data.data.clr.statement || CLR_STATEMENT}</p>
              </CardContent>
            </Card>

            <UnattributedBanner unattributed={data.data.unattributed} />

            <Card className="chart-card rounded-2xl">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2.5">
                  <span className="chart-card-header-icon bg-accent-cyan-soft text-accent-cyan border border-accent-cyan/25">
                    <Users className="h-4 w-4" />
                  </span>
                  <CardTitle className="text-sm font-medium">Cohorts — acquisition month × retention × cumulative CLR</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {cohorts.data ? (
                  cohorts.data.data.state === 'insufficient_history' ? (
                    <div data-testid="cohort-insufficient">
                      <p className="text-sm font-medium">Insufficient history</p>
                      <p className="text-xs text-muted-foreground mt-1">{cohorts.data.data.insufficientReason}</p>
                    </div>
                  ) : cohorts.data.data.cohorts.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                  ) : (
                    <CohortTable cohorts={cohorts.data.data.cohorts} months={cohorts.data.data.months} />
                  )
                ) : cohorts.isLoading ? (
                  <Skeleton className="h-[200px] w-full rounded-lg" />
                ) : (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            <Card className="chart-card rounded-2xl">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-medium">Customers — segment → customer → order history</CardTitle>
                  <Tabs value={segment || 'all'} onValueChange={onSegment}>
                    <TabsList className="tap-h max-w-full overflow-x-auto no-scrollbar">
                      <TabsTrigger value="all" className="tap-h">All</TabsTrigger>
                      <TabsTrigger value="new" className="tap-h">New</TabsTrigger>
                      <TabsTrigger value="returning" className="tap-h">Returning</TabsTrigger>
                      <TabsTrigger value="vip" className="tap-h">VIP</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent>
                {list.data ? (
                  list.data.data.rows.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="dash-table w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-muted-foreground">
                              <th className="py-2 pr-3 font-medium">Customer</th>
                              <th className="py-2 pr-3 font-medium">Segment</th>
                              <th className="py-2 pr-3 font-medium">Lifetime Orders</th>
                              <th className="py-2 pr-3 font-medium">Lifetime Revenue (CLR)</th>
                              <th className="py-2 pr-3 font-medium">In Range</th>
                              <th className="py-2 pr-3 font-medium">History</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.data.data.rows.map((r) => (
                              <tr key={r.key} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`customer-row-${r.key}`}>
                                <td className="py-2 pr-3">
                                  <span className="block font-medium">{r.name ?? r.phone ?? 'Guest'}</span>
                                  <span className="block text-xs text-muted-foreground">
                                    {r.kind === 'profile' ? 'Profile' : 'Guest'} {r.phone ? `· ${r.phone}` : ''}
                                  </span>
                                </td>
                                <td className="py-2 pr-3">
                                  <StatusBadge tone={SEGMENT_TONE[r.segment] ?? 'neutral'} data-testid={`segment-${r.segment as CustomerSegmentLabel}`}>
                                    {r.segment}
                                  </StatusBadge>
                                </td>
                                <td className="py-2 pr-3 tabular-nums">{r.lifetimeOrders}</td>
                                <td className="py-2 pr-3 tabular-nums font-medium">{formatBDT(r.lifetimeRevenue)}</td>
                                <td className="py-2 pr-3 tabular-nums">{r.rangeOrders} order(s) · {formatBDT(r.rangeRevenue)}</td>
                                <td className="py-2 pr-3">
                                  <a href={customerHistoryHref(r)} className="text-xs underline underline-offset-2">
                                    Order history
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs text-muted-foreground">
                        <span>Page {list.data.data.page} of {list.data.data.totalPages} · {list.data.data.total} customer(s)</span>
                        <span className="flex gap-2">
                          <button
                            className="tap-h px-2 underline underline-offset-2 disabled:opacity-40"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                          >
                            Prev
                          </button>
                          <button
                            className="tap-h px-2 underline underline-offset-2 disabled:opacity-40"
                            disabled={page >= list.data.data.totalPages}
                            onClick={() => setPage((p) => p + 1)}
                          >
                            Next
                          </button>
                        </span>
                      </div>
                    </>
                  )
                ) : list.isLoading ? (
                  <Skeleton className="h-[300px] w-full rounded-lg" />
                ) : (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            <DrilldownPanel filters={filters} items={CUSTOMER_DRILLDOWN} />

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
