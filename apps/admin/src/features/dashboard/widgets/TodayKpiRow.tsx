'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ShoppingCart, Truck, Wallet, RotateCcw, Coins, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { dashboardApi } from '../api'
import { useInventoryManagement } from '@/features/inventory/hooks/use-inventory-management'
import { formatCurrency, formatNumber } from '../utils'
import type { WidgetProps } from '../types'

export function TodayKpiRow({ dateRange }: WidgetProps) {
  const { data: imEnabled = true } = useInventoryManagement()
  const { data: todayKpiRes, isLoading: todayKpiLoading } = useQuery({
    queryKey: ['dashboard-today-kpi'],
    queryFn: () => dashboardApi.getTodayKpi(),
    refetchInterval: 30_000,
  })

  const { data: statsRes, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats-kpi', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getStats(dateRange.start.toISOString(), dateRange.end.toISOString()),
    refetchInterval: 30_000,
  })

  const { data: stockRes, isLoading: stockLoading } = useQuery({
    queryKey: ['dashboard-low-stock-kpi'],
    queryFn: () => dashboardApi.getLowStockProducts(),
    refetchInterval: 60_000,
  })

  const d = todayKpiRes?.data
  const stats = statsRes?.data
  const stockCount = stockRes?.data?.count ?? 0

  const kpis = [
    {
      label: "Today's Orders",
      value: d !== undefined ? formatNumber(d.orders) : '—',
      subtext: 'Orders placed today',
      icon: <ShoppingCart className="h-5 w-5 text-blue-500" />,
      bgIcon: 'bg-blue-500/10',
      borderClass: 'hover:border-blue-500/20',
      link: '/op/orders',
    },
    {
      label: 'Delivered',
      value: d !== undefined ? formatNumber(d.delivered) : '—',
      subtext: 'Delivered today',
      icon: <Truck className="h-5 w-5 text-emerald-500" />,
      bgIcon: 'bg-emerald-500/10',
      borderClass: 'hover:border-emerald-500/20',
      link: '/op/orders',
    },
    {
      label: 'Pending Payments',
      value: d !== undefined ? formatNumber(d.pendingPayments) : '—',
      subtext: 'Awaiting completion',
      icon: <Wallet className="h-5 w-5 text-amber-500" />,
      bgIcon: 'bg-amber-500/10',
      borderClass: 'hover:border-amber-500/20',
      link: '/op/payments',
    },
    {
      label: 'Pending Refunds',
      value: d !== undefined ? formatNumber(d.pendingRefunds) : '—',
      subtext: 'Awaiting resolution',
      icon: <RotateCcw className="h-5 w-5 text-rose-500" />,
      bgIcon: 'bg-rose-500/10',
      borderClass: 'hover:border-rose-500/20',
      link: '/op/refunds',
    },
    {
      label: 'Total Revenue',
      value: stats !== undefined ? formatCurrency(stats.totalRevenue) : '—',
      subtext: 'For selected period',
      icon: <Coins className="h-5 w-5 text-violet-500" />,
      bgIcon: 'bg-violet-500/10',
      borderClass: 'hover:border-violet-500/20',
      link: '/op/payments',
    },
    {
      label: 'Low Stock Count',
      value: stockCount,
      subtext: 'Items below limit',
      icon: <AlertTriangle className={`h-5 w-5 ${stockCount > 0 ? 'text-destructive animate-pulse' : 'text-gray-400'}`} />,
      bgIcon: stockCount > 0 ? 'bg-destructive/10' : 'bg-muted',
      borderClass: stockCount > 0 ? 'hover:border-destructive/20 border-destructive/10' : 'hover:border-gray-500/20',
      link: '/op/inventory',
    },
  ]

  const isLoading = todayKpiLoading || statsLoading || stockLoading

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
      {kpis.map((kpi, i) => {
        const content = (
          <Card className={`h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer ${kpi.borderClass} ${isLoading ? 'opacity-75' : ''}`}>
            <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
              <div className="flex items-start justify-between">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{kpi.label}</span>
                <div className={`p-2 rounded-lg ${kpi.bgIcon}`}>
                  {kpi.icon}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-xl md:text-2xl font-extrabold tracking-tight text-foreground">
                  {kpi.value}
                </span>
                <p className="text-[10px] text-muted-foreground font-medium">{kpi.subtext}</p>
              </div>
            </CardContent>
          </Card>
        )

        return (
          <Link key={i} to={kpi.link as any} className="block h-full">
            {content}
          </Link>
        )
      })}
    </div>
  )
}
