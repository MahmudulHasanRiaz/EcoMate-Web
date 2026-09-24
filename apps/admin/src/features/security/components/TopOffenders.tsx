import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ShieldAlert } from 'lucide-react'
import type { TopOffender } from '../types'

interface TopOffendersProps {
  data: TopOffender[] | undefined
  isLoading: boolean
  window: string
}

export function TopOffenders({ data, isLoading, window }: TopOffendersProps) {
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-danger-soft text-danger border border-danger/25">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg">Top Offenders ({window})</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 skeleton-shimmer rounded bg-muted" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offenders in this window.</p>
        ) : (
          <Table className="dash-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>ID</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((o, i) => (
                <TableRow key={`${o.actorType}-${o.actorId}`}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{o.actorType}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.actorId}</TableCell>
                  <TableCell className="text-right font-semibold">{o.count}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(o.lastSeen).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
