'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ShoppingCart,
  PackageCheck,
  Package,
  Truck,
  TruckIcon,
  Wallet,
  RotateCcw,
  Coins,
  AlertTriangle,
  CircleAlert,
  Info,
} from 'lucide-react'
import { dashboardApi } from '../api'
import { formatCurrency, formatNumber } from '../utils'
import { riseStyle } from '@/components/ui/dashboard'
import type { DatePresetKey, WidgetProps } from '../types'

interface KpiTile {
  label: string
  value: string | number
  subtext: string
  icon: React.ReactNode
  bgClass: string
  borderClass: string
  link: string
  /** Native hover tooltip (title attr) — used where the label needs a basis note. */
  tooltip?: string
}

/** Human label of the selected period, shown so no number is ambiguous. */
export const PERIOD_LABELS: Record<DatePresetKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  all_time: 'All time',
  custom: 'Custom range',
}

/** Shown on snapshot metrics, whose numbers carry no period. */
const SNAPSHOT_LABEL = 'Backlog'

export function OperationalKpiStrip({ dateRange, preset, view = 'activity' }: WidgetProps) {
  const startStr = dateRange.start.toISOString()
  const endStr = dateRange.end.toISOString()
  const isPipeline = view === 'pipeline'

  // View-aware KPI query. View is part of the key so Activity (event counts
  // in period) and Pipeline (cohort current-state) never share a cache entry.
  const {
    data: kpiRes,
    isLoading: kpiLoading,
    isError: kpiError,
  } = useQuery({
    queryKey: ['operational-kpis', view, startStr, endStr],
    queryFn: () =>
      isPipeline
        ? dashboardApi.getOperationalPipelineKpis(startStr, endStr)
        : dashboardApi.getOperationalKpis(startStr, endStr),
    refetchInterval: 30_000,
  })

  // Low stock is a CURRENT-STATE snapshot: stock on hand is not a period
  // metric, so this query intentionally has no date range in its key.
  const {
    data: stockRes,
    isLoading: stockLoading,
    isError: stockError,
  } = useQuery({
    queryKey: ['dashboard-low-stock-kpi'],
    queryFn: () => dashboardApi.getLowStockProducts(),
    refetchInterval: 60_000,
  })

  const kpi = kpiRes?.data
  const stockCount = stockRes?.data?.count
  const isLoading = kpiLoading || stockLoading
  const hasError = kpiError || stockError
  const periodLabel = PERIOD_LABELS[preset] ?? PERIOD_LABELS.last_30_days
  // Pipeline lifecycle tiles show CURRENT state of the period cohort, never
  // period events — the subtext must say so on every tile.
  const cohortLabel = `Now · ${periodLabel} cohort`

  const tiles: KpiTile[] = [
    {
      // Pipeline: the same cohort-total value, but "New Orders" would imply a
      // current "new" status — label it for what it is (no new metric).
      label: isPipeline ? 'Order Cohort' : 'New Orders',
      value: kpi ? formatNumber(kpi.newOrders) : '—',
      subtext: isPipeline ? cohortLabel : periodLabel,
      tooltip: isPipeline ? 'Total orders created in the selected period' : undefined,
      icon: <ShoppingCart className="h-4 w-4 text-info" />,
      bgClass: 'bg-info-soft',
      borderClass: 'border-info/20',
      link: '/op/orders',
    },
    {
      label: 'Confirmed',
      value: kpi ? formatNumber(kpi.confirmed) : '—',
      subtext: isPipeline ? cohortLabel : periodLabel,
      icon: <PackageCheck className="h-4 w-4 text-accent-violet" />,
      bgClass: 'bg-accent-violet-soft',
      borderClass: 'border-accent-violet/20',
      link: '/op/orders',
    },
    {
      label: 'Packed',
      value: kpi ? formatNumber(kpi.packed) : '—',
      subtext: isPipeline ? cohortLabel : periodLabel,
      icon: <Package className="h-4 w-4 text-accent-cyan" />,
      bgClass: 'bg-accent-cyan-soft',
      borderClass: 'border-accent-cyan/20',
      link: '/op/orders',
    },
    {
      // Semantics differ by view: Activity "Picked Up" = pickup EVENTS in the
      // period; Pipeline "Shipping" = cohort orders CURRENTLY in Shipping
      // status. Different labels keep the two from being confused.
      label: isPipeline ? 'Shipping' : 'Picked Up',
      value: kpi ? formatNumber(kpi.pickedUp) : '—',
      subtext: isPipeline ? cohortLabel : periodLabel,
      tooltip: isPipeline
        ? 'Orders created in the selected period, currently in Shipping status'
        : undefined,
      icon: <Truck className="h-4 w-4 text-accent-pink" />,
      bgClass: 'bg-accent-pink-soft',
      borderClass: 'border-accent-pink/20',
      link: '/op/orders',
    },
    {
      label: 'Delivered',
      value: kpi ? formatNumber(kpi.delivered) : '—',
      subtext: isPipeline ? cohortLabel : periodLabel,
      icon: <TruckIcon className="h-4 w-4 text-success" />,
      bgClass: 'bg-success-soft',
      borderClass: 'border-success/20',
      link: '/op/orders',
    },
    {
      label: 'Pending Payments',
      value: kpi ? formatNumber(kpi.pendingPayments) : '—',
      subtext: SNAPSHOT_LABEL,
      icon: <Wallet className="h-4 w-4 text-warning" />,
      bgClass: 'bg-warning-soft',
      borderClass: 'border-warning/20',
      link: '/op/payments',
    },
    {
      label: 'Pending Refunds',
      value: kpi ? formatNumber(kpi.pendingRefunds) : '—',
      subtext: SNAPSHOT_LABEL,
      icon: <RotateCcw className="h-4 w-4 text-danger" />,
      bgClass: 'bg-danger-soft',
      borderClass: 'border-danger/20',
      link: '/op/refunds',
    },
    {
      // §3.5: dashboard revenue is Σ PAID payments (cash basis) — labelled
      // as such. Accrual Net Sales recognised on delivery lives in Analytics.
      label: 'Cash collected',
      value: kpi ? formatCurrency(kpi.revenue) : '—',
      subtext: periodLabel,
      tooltip: 'Payments received; Analytics reports accrual Net Sales recognised on delivery',
      icon: <Coins className="h-4 w-4 text-success" />,
      bgClass: 'bg-success-soft',
      borderClass: 'border-success/20',
      link: '/op/payments',
    },
    {
      label: 'Low Stock',
      value: stockCount !== undefined ? formatNumber(stockCount) : '—',
      subtext: 'In stock',
      icon: (
        <AlertTriangle
          className={`h-4 w-4 ${stockCount ? 'text-danger' : 'text-muted-foreground'}`}
        />
      ),
      bgClass: stockCount ? 'bg-danger-soft' : 'bg-muted',
      borderClass: stockCount ? 'border-danger/20' : 'border-border',
      link: '/op/inventory',
    },
  ]

  return (
    <div className="space-y-2">
      {hasError && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-[11px] font-medium text-destructive"
        >
          <CircleAlert className="h-3.5 w-3.5" />
          Some KPIs could not be loaded — showing values where available.
        </p>
      )}
      {isPipeline && (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Cohort total includes orders in other current statuses not shown as separate tiles yet.
        </p>
      )}
      {/* 5 columns at lg+: row 1 is the order pipeline (New → Confirmed →
          Packed → Picked Up → Delivered), row 2 is the operational backlog.
          Wide enough that no label clips; uniform fixed-height tiles. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((tile, i) => (
          <Link key={tile.label} to={tile.link as any} className="block h-full animate-rise" style={riseStyle(i)}>
            <div
              title={tile.tooltip}
              className={`flex flex-col h-[104px] overflow-hidden rounded-2xl border bg-card p-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${tile.borderClass} ${isLoading ? 'opacity-75' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-tight line-clamp-2">
                  {tile.label}
                </span>
                <div className={`shrink-0 p-1.5 rounded-md ${tile.bgClass}`}>
                  {tile.icon}
                </div>
              </div>
              <div className="mt-auto space-y-0.5">
                <span className="block text-xl font-extrabold text-foreground tabular-nums leading-tight">
                  {tile.value}
                </span>
                <p className="text-[10px] text-muted-foreground font-medium leading-tight truncate">
                  {tile.subtext}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
