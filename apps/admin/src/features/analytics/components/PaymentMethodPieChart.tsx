'use client'

import { useQuery } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import { CHART_PALETTE } from '@/components/ui/dashboard'
import { analyticsApi } from '../api'
import type { DateRangeParams } from '../types'

interface Props { dateRange: DateRangeParams }

export function PaymentMethodPieChart({ dateRange }: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics-payment-methods', dateRange],
    queryFn: () => analyticsApi.getRevenueByPayment(dateRange),
    refetchInterval: 300_000,
  })

  const chartData = (data?.data || []).map(d => ({ name: d.method.toUpperCase(), value: d.revenue }))

  return (
    <WidgetShell title="Payment Methods" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()} icon={<Wallet className="h-4 w-4" />} iconTone="cyan">
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ৳${value.toLocaleString()}`}>
              {chartData.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
