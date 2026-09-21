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
} from 'lucide-react'
import { dashboardApi } from '../api'
import { formatCurrency, formatNumber } from '../utils'
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

export function OperationalKpiStrip({ dateRange, preset }: WidgetProps) {
  const startStr = dateRange.start.toISOString()
  const endStr = dateRange.end.toISOString()

  // Period-aware KPI query. The date range is part of the query key so a
  // filter change always produces a fresh request — never a stale cache hit.
  const {
    data: kpiRes,
    isLoading: kpiLoading,
    isError: kpiError,
  } = useQuery({
    queryKey: ['operational-kpis', startStr, endStr],
    queryFn: () => dashboardApi.getOperationalKpis(startStr, endStr),
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

  const tiles: KpiTile[] = [
    {
      label: 'New Orders',
      value: kpi ? formatNumber(kpi.newOrders) : '—',
      subtext: periodLabel,
      icon: <ShoppingCart className="h-4 w-4 text-blue-500" />,
      bgClass: 'bg-blue-500/10',
      borderClass: 'border-blue-500/20',
      link: '/op/orders',
    },
    {
      label: 'Confirmed',
      value: kpi ? formatNumber(kpi.confirmed) : '—',
      subtext: periodLabel,
      icon: <PackageCheck className="h-4 w-4 text-indigo-500" />,
      bgClass: 'bg-indigo-500/10',
      borderClass: 'border-indigo-500/20',
      link: '/op/orders',
    },
    {
      label: 'Packed',
      value: kpi ? formatNumber(kpi.packed) : '—',
      subtext: periodLabel,
      icon: <Package className="h-4 w-4 text-cyan-500" />,
      bgClass: 'bg-cyan-500/10',
      borderClass: 'border-cyan-500/20',
      link: '/op/orders',
    },
    {
      label: 'Picked Up',
      value: kpi ? formatNumber(kpi.pickedUp) : '—',
      subtext: periodLabel,
      icon: <Truck className="h-4 w-4 text-violet-500" />,
      bgClass: 'bg-violet-500/10',
      borderClass: 'border-violet-500/20',
      link: '/op/orders',
    },
    {
      label: 'Delivered',
      value: kpi ? formatNumber(kpi.delivered) : '—',
      subtext: periodLabel,
      icon: <TruckIcon className="h-4 w-4 text-emerald-500" />,
      bgClass: 'bg-emerald-500/10',
      borderClass: 'border-emerald-500/20',
      link: '/op/orders',
    },
    {
      label: 'Pending Payments',
      value: kpi ? formatNumber(kpi.pendingPayments) : '—',
      subtext: SNAPSHOT_LABEL,
      icon: <Wallet className="h-4 w-4 text-amber-500" />,
      bgClass: 'bg-amber-500/10',
      borderClass: 'border-amber-500/20',
      link: '/op/payments',
    },
    {
      label: 'Pending Refunds',
      value: kpi ? formatNumber(kpi.pendingRefunds) : '—',
      subtext: SNAPSHOT_LABEL,
      icon: <RotateCcw className="h-4 w-4 text-rose-500" />,
      bgClass: 'bg-rose-500/10',
      borderClass: 'border-rose-500/20',
      link: '/op/refunds',
    },
    {
      // §3.5: dashboard revenue is Σ PAID payments (cash basis) — labelled
      // as such. Accrual Net Sales recognised on delivery lives in Analytics.
      label: 'Cash collected',
      value: kpi ? formatCurrency(kpi.revenue) : '—',
      subtext: periodLabel,
      tooltip: 'Payments received; Analytics reports accrual Net Sales recognised on delivery',
      icon: <Coins className="h-4 w-4 text-fuchsia-500" />,
      bgClass: 'bg-fuchsia-500/10',
      borderClass: 'border-fuchsia-500/20',
      link: '/op/payments',
    },
    {
      label: 'Low Stock',
      value: stockCount !== undefined ? formatNumber(stockCount) : '—',
      subtext: 'In stock',
      icon: (
        <AlertTriangle
          className={`h-4 w-4 ${stockCount ? 'text-destructive' : 'text-gray-400'}`}
        />
      ),
      bgClass: stockCount ? 'bg-destructive/10' : 'bg-muted',
      borderClass: stockCount ? 'border-destructive/20' : 'border-gray-500/20',
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
      {/* 5 columns at lg+: row 1 is the order pipeline (New → Confirmed →
          Packed → Picked Up → Delivered), row 2 is the operational backlog.
          Wide enough that no label clips; uniform fixed-height tiles. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((tile) => (
          <Link key={tile.label} to={tile.link as any} className="block h-full">
            <div
              title={tile.tooltip}
              className={`flex flex-col h-[104px] overflow-hidden rounded-xl border bg-card p-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${tile.borderClass} ${isLoading ? 'opacity-75' : ''}`}
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
