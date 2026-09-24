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
import { Activity } from 'lucide-react'
import type { SecurityEventItem } from '../types'

interface EventTimelineProps {
  data: SecurityEventItem[] | undefined
  isLoading: boolean
}

const severityBadge: Record<string, 'danger' | 'warning' | 'success' | 'info'> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'success',
  INFO: 'info',
}

export function EventTimeline({ data, isLoading }: EventTimelineProps) {
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
            <Activity className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg">Recent Events</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 skeleton-shimmer rounded bg-muted" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          <Table className="dash-table">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {new Date(e.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.eventType}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={severityBadge[e.severity] ?? 'outline'} className="text-xs">
                      {e.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{e.source}</TableCell>
                  <TableCell className="text-xs">{e.actorType}</TableCell>
                  <TableCell className="font-mono text-xs">{e.ipAddress ?? '—'}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs">{e.description ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
