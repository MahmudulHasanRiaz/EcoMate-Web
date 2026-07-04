'use client'

import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

interface Props { dateRange: DateRangeParams }

export function OrderStatusPieChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-order-status', dateRange],
    queryFn: () => analyticsApi.getOrderStatusDistribution(dateRange),
    refetchInterval: 300_000,
  })

  const chartData = data?.data || []

  return (
    <WidgetShell title="Order Status" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={chartData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Legend />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
