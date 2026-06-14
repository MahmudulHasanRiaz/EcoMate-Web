'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{payload[0].name}</p>
        <p className="text-sm font-bold text-foreground mt-0.5">Quantity: {payload[0].value}</p>
      </div>
    )
  }
  return null
}

export function TopProducts({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-top-products', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getTopProducts(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const chartData = (data?.data || []).map(p => ({ name: p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name, quantity: p.quantity }))

  return (
    <WidgetShell title="Top Products" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()}>
      {chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground text-sm">
          No product sales recorded in this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(156, 163, 175, 0.1)" />
            <XAxis type="number" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} width={120} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)', radius: 4 }} />
            <Bar dataKey="quantity" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={30} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
