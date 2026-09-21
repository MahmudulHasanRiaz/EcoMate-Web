'use client'

import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import type { TrendPoint } from '../types'

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        <p className="text-sm font-bold text-foreground mt-0.5">৳{Number(payload[0].value).toLocaleString()}</p>
        {payload[0].payload ? (
          <p className="text-[11px] text-muted-foreground">{payload[0].payload.recognisedOrders} recognised orders</p>
        ) : null}
      </div>
    )
  }
  return null
}

/** Net-sales trend at the backend's auto-granularity (Dhaka buckets, §2 + §6 performance). */
export function TrendChart({ points, granularity, requestedGranularity }: { points: TrendPoint[]; granularity: string; requestedGranularity: string }) {
  return (
    <WidgetShell
      title="Net Sales Trend"
      description={`Auto-granularity: ${granularity}${granularity !== requestedGranularity ? ` (requested ${requestedGranularity}, stepped up past the bucket cap)` : ''} · recognised revenue only`}
      isLoading={false}
    >
      {points.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={points} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(156,163,175,0.1)" />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} dx={-5} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="netSales" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
