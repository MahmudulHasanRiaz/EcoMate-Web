import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { BlockActivityPoint } from '../types'

interface BlockActivityProps {
  data: BlockActivityPoint[] | undefined
  isLoading: boolean
}

export function BlockActivity({ data, isLoading }: BlockActivityProps) {
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg">Block Activity (Daily)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 skeleton-shimmer rounded bg-muted" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No block activity data.</p>
        ) : (
          <div className="h-64 chart-draw">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="autoBlocks" name="Auto" fill="var(--warning)" radius={[6, 6, 6, 6]} maxBarSize={28} />
                <Bar dataKey="manualBlocks" name="Manual" fill="var(--info)" radius={[6, 6, 6, 6]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
