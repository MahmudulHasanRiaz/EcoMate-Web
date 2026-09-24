'use client'

import { useQuery } from '@tanstack/react-query'
import { Globe } from 'lucide-react'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function MarketingKpiWidget({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-marketing-kpi', dateRange],
    queryFn: () => analyticsApi.getMarketingKpi(dateRange),
    refetchInterval: 900_000,
  })

  const kpi = data?.data
  const stats = [
    { label: 'Page Views', value: kpi ? kpi.pageViews.toLocaleString() : '-' },
    { label: 'Unique Visitors', value: kpi ? kpi.uniqueVisitors.toLocaleString() : '-' },
    { label: 'Bounce Rate', value: kpi ? `${kpi.bounceRate}%` : '-' },
    { label: 'Pages / Session', value: kpi ? kpi.pagesPerSession.toFixed(1) : '-' },
  ]

  return (
    <WidgetShell title="Marketing KPIs" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()} icon={<Globe className="h-4 w-4" />} iconTone="cyan">
      <div className="grid grid-cols-2 gap-4 p-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5 transition-colors duration-200 hover:bg-accent-cyan-soft/40">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{s.label}</p>
            <p className="kpi-value text-foreground mt-0.5">
              {isLoading ? '...' : s.value}
            </p>
          </div>
        ))}
      </div>
    </WidgetShell>
  )
}
