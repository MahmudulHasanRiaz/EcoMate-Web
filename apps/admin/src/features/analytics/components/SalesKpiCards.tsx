'use client'

import { useQuery } from '@tanstack/react-query'
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
  const cards = [
    { label: 'Total Revenue', value: kpi ? `৳${kpi.totalRevenue.toLocaleString()}` : '-', subtext: 'Revenue from paid orders' },
    { label: 'Total Orders', value: kpi ? kpi.totalOrders.toLocaleString() : '-', subtext: 'Orders placed' },
    { label: 'AOV', value: kpi ? `৳${kpi.aov.toLocaleString()}` : '-', subtext: 'Avg order value' },
    { label: 'Refund Rate', value: kpi ? `${kpi.refundRate}%` : '-', subtext: `${kpi?.totalRefunds.toLocaleString() || 0} refunded` },
  ]

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="rounded-xl border bg-card p-5">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{c.label}</p>
            <p className="text-2xl font-bold mt-1.5 text-foreground">
              {isLoading ? <span className="text-muted-foreground">...</span> : c.value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{c.subtext}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Profit Calculation:</span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          hasAccounting
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}>
          {hasAccounting ? 'Actual Profit' : 'Estimated Profit'}
        </span>
      </div>
    </>
  )
}
