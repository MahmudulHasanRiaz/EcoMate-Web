'use client'

import { TrendingUp } from 'lucide-react'
import { Area, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { WidgetShell } from '../../dashboard/components/WidgetShell'
import type { SalesTrendPoint } from '../types'

interface MergedPoint {
  label: string
  booked: number
  recognised: number
  cash: number
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} className="text-sm font-bold mt-0.5" style={{ color: p.color ?? p.stroke }}>
            {p.name}: ৳{Number(p.value).toLocaleString()}
          </p>
        ))}
      </div>
    )
  }
  return null
}

/**
 * Booked vs Recognised vs Cash trends (P5, §2.1 lenses) — three date bases on
 * one axis, never mixed. Each line keeps its own basis caption below.
 */
export function SalesTrendChart({
  booked,
  recognised,
  cash,
  granularity,
  requestedGranularity,
}: {
  booked: SalesTrendPoint[]
  recognised: SalesTrendPoint[]
  cash: SalesTrendPoint[]
  granularity: string
  requestedGranularity: string
}) {
  const merged: MergedPoint[] = booked.map((b, i) => ({
    label: b.label,
    booked: b.amount,
    recognised: recognised[i]?.amount ?? 0,
    cash: cash[i]?.amount ?? 0,
  }))
  return (
    <WidgetShell
      title="Booked vs Recognised vs Cash"
      description={`Grouped by ${granularity}${granularity !== requestedGranularity ? ` (asked for ${requestedGranularity}, grouped wider to fit)` : ''}`}
      isLoading={false}
      icon={<TrendingUp className="h-4 w-4" />}
      iconTone="info"
    >
      {merged.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={merged} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} className="chart-draw">
            <defs>
              <linearGradient id="salesRecognised" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--success)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} minTickGap={24} />
            <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} dx={-5} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="recognised" name="Recognised (when delivered)" fill="url(#salesRecognised)" stroke="none" legendType="none" />
            <Line type="monotone" dataKey="booked" name="Booked (when placed)" stroke="var(--info)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="recognised" name="Recognised (when delivered)" stroke="var(--success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="cash" name="Cash (when paid)" stroke="var(--warning)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">
        Three lines, never mixed. Booked counts orders when placed. Recognised counts Delivered orders. Cash counts paid orders.
      </p>
    </WidgetShell>
  )
}
