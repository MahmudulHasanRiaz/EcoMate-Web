'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function TopProducts({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-top-products', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getTopProducts(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const chartData = (data?.data || []).map(p => ({ name: p.name.length > 20 ? p.name.slice(0, 20) + '…' : p.name, quantity: p.quantity }))

  return (
    <WidgetShell title="Top Products" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} layout="vertical" background={{ fill: 'transparent' }}>
          <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
          <Bar dataKey="quantity" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </WidgetShell>
  )
}
