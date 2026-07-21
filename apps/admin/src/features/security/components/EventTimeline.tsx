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
import type { SecurityEventItem } from '../types'

interface EventTimelineProps {
  data: SecurityEventItem[] | undefined
  isLoading: boolean
}

const severityBadge: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800 hover:bg-red-100',
  HIGH: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  MEDIUM: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  LOW: 'bg-green-100 text-green-800 hover:bg-green-100',
  INFO: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
}

export function EventTimeline({ data, isLoading }: EventTimelineProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Events</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          <Table>
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
                    <Badge className={`text-xs ${severityBadge[e.severity] ?? ''}`}>
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
