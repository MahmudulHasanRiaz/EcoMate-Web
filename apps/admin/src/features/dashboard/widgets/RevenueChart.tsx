'use client'

import { useQuery } from '@tanstack/react-query'
import { Coins } from 'lucide-react'
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { chartFillForName } from '@/components/ui/dashboard'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{payload[0].name}</p>
        <p className="text-sm font-bold text-foreground mt-0.5">৳{Number(payload[0].value).toLocaleString()}</p>
      </div>
    )
  }
  return null
}

export function RevenueChart({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-revenue-payment', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getRevenueByPaymentMethod(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const chartData = (data?.data || []).map(item => ({
    name: item.method.toUpperCase(),
    total: item.revenue
  }))

  return (
    <WidgetShell title="Revenue by Payment Method" isLoading={isLoading} error={error ?? undefined} onRetry={() => refetch()} icon={<Coins className="h-4 w-4" />} iconTone="success">
      {chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground text-sm">
          No revenue recorded in this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} className="chart-draw">
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} dx={-5} />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            <Bar dataKey="total" radius={[6, 6, 6, 6]} maxBarSize={60}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={chartFillForName(d.name, i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
