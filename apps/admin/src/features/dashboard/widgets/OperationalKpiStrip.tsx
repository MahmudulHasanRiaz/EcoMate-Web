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
import { CountUp, riseStyle, type KpiAccent } from '@/components/ui/dashboard'
import type { DatePresetKey, WidgetProps } from '../types'

interface KpiTile {
  label: string
  /** Null while loading — renders "—", never a misleading 0. */
  raw: number | null
  format: (v: number) => string
  subtext: string
  icon: React.ReactNode
  accent: KpiAccent
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
      // Same label in both views (two names for one thing confused users).
      // View meaning lives in the subtext + tooltip, never in the label.
      label: 'New Orders',
      raw: kpi ? kpi.newOrders : null,
      format: formatNumber,
      subtext: isPipeline ? cohortLabel : periodLabel,
      tooltip: isPipeline ? 'Total orders created in the selected period' : undefined,
      icon: <ShoppingCart className="h-4 w-4" />,
      accent: 'info',
      link: '/op/orders',
    },
    {
      label: 'Confirmed',
      raw: kpi ? kpi.confirmed : null,
      format: formatNumber,
      subtext: isPipeline ? cohortLabel : periodLabel,
      icon: <PackageCheck className="h-4 w-4" />,
      accent: 'violet',
      link: '/op/orders',
    },
    {
      label: 'Packed',
      raw: kpi ? kpi.packed : null,
      format: formatNumber,
      subtext: isPipeline ? cohortLabel : periodLabel,
      icon: <Package className="h-4 w-4" />,
      accent: 'cyan',
      link: '/op/orders',
    },
    {
      // Same label in both views: Activity counts pickup events in the period,
      // Pipeline counts cohort orders currently in Shipping status. Subtext +
      // tooltip carry that distinction.
      label: 'Shipping',
      raw: kpi ? kpi.pickedUp : null,
      format: formatNumber,
      subtext: isPipeline ? cohortLabel : periodLabel,
      tooltip: isPipeline
        ? 'Orders created in the selected period, currently in Shipping status'
        : undefined,
      icon: <Truck className="h-4 w-4" />,
      accent: 'pink',
      link: '/op/orders',
    },
    {
      label: 'Delivered',
      raw: kpi ? kpi.delivered : null,
      format: formatNumber,
      subtext: isPipeline ? cohortLabel : periodLabel,
      icon: <TruckIcon className="h-4 w-4" />,
      accent: 'success',
      link: '/op/orders',
    },
    {
      label: 'Pending Payments',
      raw: kpi ? kpi.pendingPayments : null,
      format: formatNumber,
      subtext: SNAPSHOT_LABEL,
      icon: <Wallet className="h-4 w-4" />,
      accent: 'warning',
      link: '/op/payments',
    },
    {
      label: 'Pending Refunds',
      raw: kpi ? kpi.pendingRefunds : null,
      format: formatNumber,
      subtext: SNAPSHOT_LABEL,
      icon: <RotateCcw className="h-4 w-4" />,
      accent: 'danger',
      link: '/op/refunds',
    },
    {
      // §3.5: dashboard revenue is Σ PAID payments (cash basis) — labelled
      // as such. Accrual Net Sales recognised on delivery lives in Analytics.
      label: 'Cash collected',
      raw: kpi ? kpi.revenue : null,
      format: formatCurrency,
      subtext: periodLabel,
      tooltip: 'Payments received; Analytics reports accrual Net Sales recognised on delivery',
      icon: <Coins className="h-4 w-4" />,
      accent: 'success',
      link: '/op/payments',
    },
    {
      label: 'Low Stock',
      raw: stockCount ?? null,
      format: formatNumber,
      subtext: 'In stock',
      icon: <AlertTriangle className="h-4 w-4" />,
      accent: stockCount ? 'danger' : 'success',
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
          Packed → Shipping → Delivered), row 2 is the operational backlog.
          Analytics-style kpi-cards with per-tile accent, animated numbers,
          and staggered rise. Re-mounted per view so switching views replays
          the entrance smoothly. */}
      <div key={view} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((tile, i) => (
          <Link key={tile.label} to={tile.link as any} className="block h-full animate-rise" style={riseStyle(i)}>
            <div
              title={tile.tooltip}
              className={`kpi-card kpi-accent-${tile.accent} flex flex-col h-full p-3 ${isLoading ? 'opacity-75' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground leading-tight line-clamp-2">
                  {tile.label}
                </span>
                <span className="kpi-icon-badge shrink-0" aria-hidden>
                  {tile.icon}
                </span>
              </div>
              <div className="mt-auto space-y-0.5 pt-2">
                <span
                  className="kpi-value block leading-tight truncate"
                  title={tile.raw === null ? '—' : tile.format(tile.raw)}
                >
                  {tile.raw === null ? '—' : <CountUp value={tile.raw} format={tile.format} />}
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
