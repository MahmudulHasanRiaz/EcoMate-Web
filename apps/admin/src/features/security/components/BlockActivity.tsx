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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Block Activity (Daily)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded bg-muted" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No block activity data.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="autoBlocks" name="Auto" fill="#f97316" radius={[2, 2, 0, 0]} />
                <Bar dataKey="manualBlocks" name="Manual" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
