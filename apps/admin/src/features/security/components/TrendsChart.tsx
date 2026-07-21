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

const severityColors: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
  INFO: '#3b82f6',
}

export function TrendsChart({ data, isLoading, interval }: TrendsChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Event Trends ({interval})</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded bg-muted" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trend data available.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
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
                  stroke="#3b82f6"
                  fill="#93c5fd"
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
