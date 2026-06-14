'use client'

import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function RevenueChart({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-revenue', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getStats(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const chartData = data?.data.totalRevenue ? [{ name: 'Revenue', total: data.data.totalRevenue }] : []

  return (
    <WidgetShell title="Revenue" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} background={{ fill: 'transparent' }}>
          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} />
          <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
          <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </WidgetShell>
  )
}
