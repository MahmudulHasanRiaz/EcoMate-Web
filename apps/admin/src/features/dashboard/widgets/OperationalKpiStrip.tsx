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
} from 'lucide-react'
import { dashboardApi } from '../api'
import { formatCurrency, formatNumber } from '../utils'
import type { WidgetProps } from '../types'

interface KpiTile {
  label: string
  value: string | number
  subtext: string
  icon: React.ReactNode
  bgClass: string
  borderClass: string
  link: string
}

export function OperationalKpiStrip({ dateRange, preset }: WidgetProps) {
  const startStr = dateRange.start.toISOString()
  const endStr = dateRange.end.toISOString()

  const { data: kpiRes, isLoading: kpiLoading } = useQuery({
    queryKey: ['operational-kpis', startStr, endStr],
    queryFn: () => dashboardApi.getOperationalKpis(startStr, endStr),
    refetchInterval: 30_000,
  })

  const { data: stockRes, isLoading: stockLoading } = useQuery({
    queryKey: ['dashboard-low-stock-kpi'],
    queryFn: () => dashboardApi.getLowStockProducts(),
    refetchInterval: 60_000,
  })

  const kpi = kpiRes?.data
  const stockCount = stockRes?.data?.count ?? 0
  const isLoading = kpiLoading || stockLoading

  const periodLabel = (() => {
    const p = preset.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    return p
  })()

  const tiles: KpiTile[] = [
    {
      label: 'New Orders',
      value: kpi ? formatNumber(kpi.newOrders) : '—',
      subtext: `${periodLabel} range`,
      icon: <ShoppingCart className="h-4 w-4 text-blue-500" />,
      bgClass: 'bg-blue-500/10',
      borderClass: 'border-blue-500/20',
      link: '/op/orders',
    },
    {
      label: 'Confirmed',
      value: kpi ? formatNumber(kpi.confirmed) : '—',
      subtext: `${periodLabel} range`,
      icon: <PackageCheck className="h-4 w-4 text-indigo-500" />,
      bgClass: 'bg-indigo-500/10',
      borderClass: 'border-indigo-500/20',
      link: '/op/orders',
    },
    {
      label: 'Packed',
      value: kpi ? formatNumber(kpi.packed) : '—',
      subtext: `${periodLabel} range`,
      icon: <Package className="h-4 w-4 text-cyan-500" />,
      bgClass: 'bg-cyan-500/10',
      borderClass: 'border-cyan-500/20',
      link: '/op/orders',
    },
    {
      label: 'Picked Up',
      value: kpi ? formatNumber(kpi.pickedUp) : '—',
      subtext: `${periodLabel} range`,
      icon: <Truck className="h-4 w-4 text-violet-500" />,
      bgClass: 'bg-violet-500/10',
      borderClass: 'border-violet-500/20',
      link: '/op/orders',
    },
    {
      label: 'Delivered',
      value: kpi ? formatNumber(kpi.delivered) : '—',
      subtext: `${periodLabel} range`,
      icon: <TruckIcon className="h-4 w-4 text-emerald-500" />,
      bgClass: 'bg-emerald-500/10',
      borderClass: 'border-emerald-500/20',
      link: '/op/orders',
    },
    {
      label: 'Pending Payments',
      value: kpi ? formatNumber(kpi.pendingPayments) : '—',
      subtext: 'Current backlog',
      icon: <Wallet className="h-4 w-4 text-amber-500" />,
      bgClass: 'bg-amber-500/10',
      borderClass: 'border-amber-500/20',
      link: '/op/payments',
    },
    {
      label: 'Pending Refunds',
      value: kpi ? formatNumber(kpi.pendingRefunds) : '—',
      subtext: 'Current backlog',
      icon: <RotateCcw className="h-4 w-4 text-rose-500" />,
      bgClass: 'bg-rose-500/10',
      borderClass: 'border-rose-500/20',
      link: '/op/refunds',
    },
    {
      label: 'Revenue',
      value: kpi ? formatCurrency(kpi.revenue) : '—',
      subtext: `${periodLabel} range`,
      icon: <Coins className="h-4 w-4 text-fuchsia-500" />,
      bgClass: 'bg-fuchsia-500/10',
      borderClass: 'border-fuchsia-500/20',
      link: '/op/payments',
    },
    {
      label: 'Low Stock',
      value: formatNumber(stockCount),
      subtext: 'Items below limit',
      icon: (
        <AlertTriangle
          className={`h-4 w-4 ${stockCount > 0 ? 'text-destructive' : 'text-gray-400'}`}
        />
      ),
      bgClass: stockCount > 0 ? 'bg-destructive/10' : 'bg-muted',
      borderClass:
        stockCount > 0 ? 'border-destructive/20' : 'border-gray-500/20',
      link: '/op/inventory',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9 gap-3">
      {tiles.map((tile) => (
        <Link key={tile.label} to={tile.link as any} className="block h-full">
          <div
            className={`group relative flex flex-col h-full min-h-[110px] rounded-xl border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${tile.borderClass} ${isLoading ? 'opacity-75' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {tile.label}
              </span>
              <div className={`p-1.5 rounded-md ${tile.bgClass}`}>
                {tile.icon}
              </div>
            </div>
            <div className="mt-1.5 space-y-0.5 flex-1">
              <span className="block text-xl font-extrabold text-foreground tabular-nums">
                {tile.value}
              </span>
              <p className="text-[10px] text-muted-foreground font-medium leading-tight">
                {tile.subtext}
              </p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
