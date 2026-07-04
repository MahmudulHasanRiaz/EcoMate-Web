'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function TrafficSourcesChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-traffic-sources', dateRange],
    queryFn: () => analyticsApi.getTrafficSources(dateRange),
    refetchInterval: 900_000,
  })

  const chartData = (data?.data?.sources || []).map(s => ({ name: s.source, visits: s.visits, pct: s.percentage }))

  return (
    <WidgetShell title="Traffic Sources" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(156,163,175,0.1)" />
              <XAxis type="number" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} width={70} />
              <Tooltip formatter={(v: number, n: string) => [v.toLocaleString(), n === 'visits' ? 'Visits' : '']} />
              <Bar dataKey="visits" fill="#3b82f6" radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1">
            {chartData.map(s => (
              <div key={s.name} className="flex justify-between text-xs px-1">
                <span className="capitalize text-muted-foreground">{s.name}</span>
                <span className="font-medium">{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </WidgetShell>
  )
}
