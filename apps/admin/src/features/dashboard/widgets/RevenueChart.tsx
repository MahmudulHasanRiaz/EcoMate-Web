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
        <BarChart data={chartData}>
          <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} />
          <Tooltip />
          <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </WidgetShell>
  )
}
