'use client'

import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        <p className="text-sm font-bold text-foreground mt-0.5">৳{Number(payload[0].value).toLocaleString()}</p>
      </div>
    )
  }
  return null
}

export function RevenueTrendChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-revenue-trend', dateRange],
    queryFn: () => analyticsApi.getRevenueTrend(dateRange),
    refetchInterval: 300_000,
  })

  const chartData = data?.data?.data || []

  return (
    <WidgetShell title="Revenue Trend" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(156,163,175,0.1)" />
            <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} dx={-5} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
