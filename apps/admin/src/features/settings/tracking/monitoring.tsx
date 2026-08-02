import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { monitoringApi, type DispatchFunnel } from './monitoring-api'
import { TrackingTabs } from './tracking-nav'

const FUNNEL_COLUMNS: { key: keyof DispatchFunnel; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'sending', label: 'Sending' },
  { key: 'sent', label: 'Sent' },
  { key: 'retry', label: 'Retry' },
  { key: 'failed', label: 'Failed' },
  { key: 'dead', label: 'Dead' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'deduped', label: 'Deduped' },
]

/**
 * Tracking monitoring dashboard (Phase 6, design §14). Read-only aggregate views
 * over the CAPI tracking pipeline served by the backend monitoring endpoints.
 * Every section is a TanStack Query over the same admin API; the timeline is a
 * search-driven query keyed on the submitted event/order ID.
 */
export function TrackingMonitoring() {
  const overview = useQuery({
    queryKey: ['tracking-monitoring', 'overview'],
    queryFn: () => monitoringApi.overview(),
  })
  const failures = useQuery({
    queryKey: ['tracking-monitoring', 'failures'],
    queryFn: () => monitoringApi.failures(),
  })
  const freshness = useQuery({
    queryKey: ['tracking-monitoring', 'freshness'],
    queryFn: () => monitoringApi.freshness(),
  })
  const dedup = useQuery({
    queryKey: ['tracking-monitoring', 'dedup'],
    queryFn: () => monitoringApi.dedup(),
  })

  const [eventIdInput, setEventIdInput] = useState('')
  const [searchedEventId, setSearchedEventId] = useState<string | null>(null)
  const timeline = useQuery({
    queryKey: ['tracking-monitoring', 'timeline', searchedEventId],
    queryFn: () => monitoringApi.timeline(searchedEventId!),
    enabled: !!searchedEventId,
  })

  if (overview.isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[400px]'>
        <Loader2 className='animate-spin h-8 w-8 text-primary' />
      </div>
    )
  }

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Tracking Monitoring</h2>
        <p className='text-muted-foreground'>
          Aggregate views over the CAPI tracking pipeline (last 24 hours).
        </p>
      </div>
      <TrackingTabs />
      <Separator className='my-6' />

      <div className='grid gap-4 md:grid-cols-2'>
        {/* Volume by event type */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Volume by Event Type</CardTitle>
            <CardDescription>Snapshots captured in the last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            {(overview.data?.volumeByEventType ?? []).length === 0 ? (
              <p className='text-sm text-muted-foreground'>No events captured in the window.</p>
            ) : (
              <ul className='space-y-2'>
                {(overview.data?.volumeByEventType ?? []).map((row) => (
                  <li key={row.eventType} className='flex items-center justify-between border-b pb-2 last:border-0'>
                    <span className='text-sm'>{row.eventType}</span>
                    <span className='text-sm font-semibold'>{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* DEAD / DLQ */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Dead Letters</CardTitle>
            <CardDescription>Terminal outboxes and the relay DLQ backlog</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <p className='text-sm text-muted-foreground'>DEAD events</p>
                <p className='text-3xl font-bold'>{overview.data?.deadStats.deadCount ?? 0}</p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>DLQ depth</p>
                <p className='text-3xl font-bold'>{overview.data?.deadStats.dlqDepth ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-provider dispatch funnel */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Dispatch Funnel</CardTitle>
          <CardDescription>Per-provider dispatch state over the last 24 hours</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                {FUNNEL_COLUMNS.map((col) => (
                  <TableHead key={col.key}>{col.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(overview.data?.dispatchFunnel ?? {}).map(([provider, funnel]) => (
                <TableRow key={provider}>
                  <TableCell className='font-medium'>{provider}</TableCell>
                  {FUNNEL_COLUMNS.map((col) => (
                    <TableCell key={col.key}>{funnel[col.key]}</TableCell>
                  ))}
                </TableRow>
              ))}
              {Object.keys(overview.data?.dispatchFunnel ?? {}).length === 0 && (
                <TableRow>
                  <TableCell colSpan={FUNNEL_COLUMNS.length + 1} className='text-muted-foreground'>
                    No dispatch data in the window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className='grid gap-4 md:grid-cols-2'>
        {/* Top failures */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Top Failures</CardTitle>
            <CardDescription>Most common terminal failure reasons</CardDescription>
          </CardHeader>
          <CardContent>
            {(failures.data?.topFailures ?? []).length === 0 ? (
              <p className='text-sm text-muted-foreground'>No failures in the window.</p>
            ) : (
              <ul className='space-y-2'>
                {(failures.data?.topFailures ?? []).map((row, i) => (
                  <li key={i} className='flex items-start justify-between gap-4 border-b pb-2 last:border-0'>
                    <span className='text-sm break-words'>{row.errorMsg || '(no message)'}</span>
                    <span className='text-sm font-semibold'>{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Retry histogram */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Retry Histogram</CardTitle>
            <CardDescription>Dispatch attempts per event</CardDescription>
          </CardHeader>
          <CardContent>
            {(failures.data?.retryHistogram ?? []).length === 0 ? (
              <p className='text-sm text-muted-foreground'>No retries in the window.</p>
            ) : (
              <ul className='space-y-2'>
                {(failures.data?.retryHistogram ?? []).map((row) => (
                  <li key={row.attemptCount} className='flex items-center justify-between border-b pb-2 last:border-0'>
                    <span className='text-sm'>
                      {row.attemptCount} attempts · {row.count} event{row.count === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className='grid gap-4 md:grid-cols-2'>
        {/* Freshness */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Freshness</CardTitle>
            <CardDescription>Capture to dispatch latency</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <p className='text-sm text-muted-foreground'>Average</p>
                <p className='text-2xl font-bold'>
                  {(freshness.data?.avgCaptureToDispatchSec ?? 0).toFixed(1)}s
                </p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>P95</p>
                <p className='text-2xl font-bold'>
                  {(freshness.data?.p95CaptureToDispatchSec ?? 0).toFixed(1)}s
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dedup keys */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Dedup Keys</CardTitle>
            <CardDescription>Dedup-relevant identifier usage in the window</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className='space-y-2'>
              {(dedup.data?.keyUsage ?? []).map((row) => (
                <li key={row.key} className='flex items-center justify-between border-b pb-2 last:border-0'>
                  <span className='text-sm font-mono'>{row.key}</span>
                  <span className='text-sm font-semibold'>{row.events}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Timeline search */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Event Timeline</CardTitle>
          <CardDescription>Lifecycle of a single event by its event ID or order ID</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='mb-4 flex items-center gap-2'>
            <Input
              value={eventIdInput}
              onChange={(e) => setEventIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearchedEventId(eventIdInput.trim())
              }}
              placeholder='Event ID'
              className='max-w-sm'
            />
            <Button onClick={() => setSearchedEventId(eventIdInput.trim())}>
              <Search className='h-4 w-4 mr-2' />
              Search
            </Button>
          </div>

          {timeline.isPending && <Loader2 className='animate-spin h-5 w-5 text-primary' />}

          {timeline.isError && (
            <p className='text-sm text-destructive'>Could not load the timeline for this event.</p>
          )}

          {timeline.data && (
            <div className='space-y-4'>
              <div className='flex flex-wrap items-center gap-x-6 gap-y-1 text-sm'>
                <p className='text-muted-foreground'>
                  Event <span className='font-mono font-semibold text-foreground'>{searchedEventId}</span>
                </p>
                <p className='text-muted-foreground'>
                  Type <span className='font-semibold text-foreground'>{timeline.data.eventType ?? 'unknown'}</span>
                </p>
                <p className='text-muted-foreground'>
                  Status <span className='font-semibold text-foreground'>{timeline.data.status ?? 'unknown'}</span>
                </p>
              </div>

              {timeline.data.events.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No dispatch events found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Attempt</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timeline.data.events.map((ev) => (
                      <TableRow key={ev.id}>
                        <TableCell>{ev.fromStatus ?? '—'}</TableCell>
                        <TableCell>{ev.toStatus}</TableCell>
                        <TableCell>{ev.provider ?? '—'}</TableCell>
                        <TableCell>{ev.attempt ?? '—'}</TableCell>
                        <TableCell>{ev.message ?? '—'}</TableCell>
                        <TableCell>{new Date(ev.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
