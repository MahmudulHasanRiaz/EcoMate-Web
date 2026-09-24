import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TrendDataPoint } from '../types'

interface TrendsChartProps {
  data: TrendDataPoint[] | undefined
  isLoading: boolean
  interval: string
}

/** Severity → semantic chart fill (shared token palette). */
export const severityColors: Record<string, string> = {
  CRITICAL: 'var(--danger)',
  HIGH: 'var(--warning)',
  MEDIUM: 'var(--warning)',
  LOW: 'var(--success)',
  INFO: 'var(--info)',
}

export function TrendsChart({ data, isLoading, interval }: TrendsChartProps) {
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg">Event Trends ({interval})</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 skeleton-shimmer rounded bg-muted" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trend data available.</p>
        ) : (
          <div className="h-64 chart-draw">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="securityTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--info)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--info)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: string) => {
                    const d = new Date(v)
                    return interval === 'hourly'
                      ? d.toLocaleTimeString([], { hour: '2-digit' })
                      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                  }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(v) => new Date(String(v)).toLocaleString()}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--info)"
                  fill="url(#securityTrend)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
