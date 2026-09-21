'use client'

import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
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
      description={`Auto-granularity: ${granularity}${granularity !== requestedGranularity ? ` (requested ${requestedGranularity}, stepped up past the bucket cap)` : ''}`}
      isLoading={false}
    >
      {merged.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={merged} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(156,163,175,0.1)" />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `৳${v}`} dx={-5} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="booked" name="Booked (Order.createdAt)" stroke="#0ea5e9" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="recognised" name="Recognised (Delivered)" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="cash" name="Cash (Payment.createdAt)" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">
        Three bases, never mixed — Booked is intake only (never in the ladder); Recognised is the P&L basis; Cash is PAID payments.
      </p>
    </WidgetShell>
  )
}
