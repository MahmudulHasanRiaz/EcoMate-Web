'use client'

import { useQuery } from '@tanstack/react-query'
import { Banknote, Receipt, ShoppingCart, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CountUp, riseStyle } from '@/components/ui/dashboard'
import { analyticsApi } from '../api'
import { useLicenseStore } from '@/stores/license-store'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function SalesKpiCards({ dateRange }: Props) {
  const hasAccounting = useLicenseStore(s => s.hasFeature('admin_accounting'))
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-sales-kpi', dateRange],
    queryFn: () => analyticsApi.getSalesKpi(dateRange),
    refetchInterval: 300_000,
  })

  const kpi = data?.data
  const bdt = (v: number) => `৳${Math.round(v).toLocaleString()}`
  const num = (v: number) => Math.round(v).toLocaleString()
  const cards = [
    { label: 'Total Revenue', value: kpi ? `৳${kpi.totalRevenue.toLocaleString()}` : '-', numeric: kpi?.totalRevenue, format: bdt, subtext: 'Revenue from paid orders', accent: 'kpi-accent-success', icon: Banknote },
    { label: 'Total Orders', value: kpi ? kpi.totalOrders.toLocaleString() : '-', numeric: kpi?.totalOrders, format: num, subtext: 'Orders placed', accent: 'kpi-accent-info', icon: ShoppingCart },
    { label: 'AOV', value: kpi ? `৳${kpi.aov.toLocaleString()}` : '-', numeric: kpi?.aov, format: bdt, subtext: 'Avg order value', accent: 'kpi-accent-success', icon: Receipt },
    { label: 'Refund Rate', value: kpi ? `${kpi.refundRate}%` : '-', numeric: null, format: num, subtext: `${kpi?.totalRefunds.toLocaleString() || 0} refunded`, accent: 'kpi-accent-danger', icon: Undo2 },
  ]

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={c.label} className={`kpi-card ${c.accent} p-5 animate-rise`} style={riseStyle(i)}>
            <div className="flex items-center gap-2">
              <span className="kpi-icon-badge" aria-hidden>
                <c.icon className="h-4 w-4" />
              </span>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider truncate">{c.label}</p>
            </div>
            <p className="kpi-value mt-1.5 text-foreground">
              {isLoading ? (
                <span className="text-muted-foreground">...</span>
              ) : c.numeric !== null && c.numeric !== undefined ? (
                <CountUp value={c.numeric} format={c.format} />
              ) : (
                c.value
              )}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{c.subtext}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Profit Calculation:</span>
        <Badge variant={hasAccounting ? 'success' : 'warning'}>
          {hasAccounting ? 'Actual Profit' : 'Estimated Profit'}
        </Badge>
      </div>
    </>
  )
}
