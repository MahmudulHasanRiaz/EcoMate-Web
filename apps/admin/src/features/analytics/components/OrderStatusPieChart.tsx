'use client'

import { useQuery } from '@tanstack/react-query'
import { PieChart as PieIcon } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { chartFillForName } from '@/components/ui/dashboard'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function OrderStatusPieChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-order-status', dateRange],
    queryFn: () => analyticsApi.getOrderStatusDistribution(dateRange),
    refetchInterval: 300_000,
  })

  const chartData = data?.data || []

  return (
    <WidgetShell title="Order Status" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()} icon={<PieIcon className="h-4 w-4" />} iconTone="info">
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={chartData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
              {chartData.map((d: any, i: number) => <Cell key={i} fill={chartFillForName(d.status ?? d.name ?? '', i)} />)}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
