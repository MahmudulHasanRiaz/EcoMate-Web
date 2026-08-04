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

// Keys are context-availability counts (not event dedup) for the context_* rows.
const DEDUP_KEY_LABELS: Record<string, string> = {
  event_id: 'event_id',
  context_external_id: 'context external_id (availability)',
  fbp: 'fbp (contexts)',
  fbc: 'fbc (contexts)',
}

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
  const health = useQuery({
    queryKey: ['tracking-monitoring', 'health'],
    queryFn: () => monitoringApi.health(),
    refetchInterval: 60_000,
  })
  const mirrorCapture = useQuery({
    queryKey: ['tracking-monitoring', 'mirror-capture'],
    queryFn: () => monitoringApi.mirrorCapture(),
  })
  const quality = useQuery({
    queryKey: ['tracking-monitoring', 'quality'],
    queryFn: () => monitoringApi.quality(),
  })
  const watchdog = useQuery({
    queryKey: ['tracking-monitoring', 'watchdog'],
    queryFn: () => monitoringApi.watchdog(),
    refetchInterval: 60_000,
  })
  const healthScore = useQuery({
    queryKey: ['tracking-monitoring', 'health-score'],
    queryFn: () => monitoringApi.healthScore(),
    refetchInterval: 60_000,
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

      {/* Relay health + coverage (Wave 1) */}
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Pipeline Health</CardTitle>
            <CardDescription>Relay, Redis, BullMQ worker, dispatcher</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <p className='text-sm text-muted-foreground'>Relay</p>
                <p
                  className={`text-2xl font-bold ${
                    health.data?.relayHealth?.relayEnabled ? 'text-emerald-600' : 'text-rose-500'
                  }`}
                >
                  {health.data?.relayHealth?.relayEnabled ? 'ON' : 'OFF'}
                </p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Pending</p>
                <p className='text-2xl font-bold'>{health.data?.relayHealth?.pendingCount ?? 0}</p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Claimed</p>
                <p className='text-2xl font-bold'>{health.data?.relayHealth?.claimedCount ?? 0}</p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Oldest pending</p>
                <p className='text-2xl font-bold'>
                  {health.data?.relayHealth?.oldestPendingAgeSec != null
                    ? `${health.data.relayHealth.oldestPendingAgeSec}s`
                    : '—'}
                </p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Redis</p>
                <p
                  className={`text-2xl font-bold ${
                    health.data?.redisHealth?.connected ? 'text-emerald-600' : 'text-rose-500'
                  }`}
                >
                  {health.data?.redisHealth?.connected ? 'OK' : 'DOWN'}
                </p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Queue</p>
                <p className='text-2xl font-bold'>
                  {health.data?.queueHealth?.reachable
                    ? `wait ${health.data.queueHealth.waiting} · act ${health.data.queueHealth.active}`
                    : 'DOWN'}
                </p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Queue failed</p>
                <p className='text-2xl font-bold'>{health.data?.queueHealth?.failed ?? 0}</p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Dispatcher sending</p>
                <p className='text-2xl font-bold'>{health.data?.dispatcherHealth?.sending ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Browser Mirror Capture</CardTitle>
            <CardDescription>Share of captured events that arrived via the browser mirror (not Meta coverage)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <p className='text-sm text-muted-foreground'>Browser-origin</p>
                <p className='text-2xl font-bold'>{mirrorCapture.data?.mirrorCapture?.browserOrigin ?? 0}</p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Server-origin</p>
                <p className='text-2xl font-bold'>{mirrorCapture.data?.mirrorCapture?.serverOrigin ?? 0}</p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Mirror ratio</p>
                <p className='text-2xl font-bold'>
                  {((mirrorCapture.data?.mirrorCapture?.browserMirrorRatio ?? 0) * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className='text-sm text-muted-foreground'>Total captures</p>
                <p className='text-2xl font-bold'>{mirrorCapture.data?.mirrorCapture?.totalSnapshots ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Health score + watchdog (Wave-2.4) */}
      <div className='grid gap-4 md:grid-cols-2'>
        {/* Health score */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Health Score</CardTitle>
            <CardDescription>Composite pipeline drift signal (0–100), refreshed every minute</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-3'>
              <p className='text-4xl font-bold'>{healthScore.data?.healthScore.score ?? '—'}</p>
              <span className='text-lg font-semibold text-muted-foreground'>
                {healthScore.data?.healthScore.grade ?? ''}
              </span>
            </div>
            {healthScore.data?.healthScore.penalties.length ? (
              <ul className='mt-4 space-y-2'>
                {healthScore.data.healthScore.penalties.map((p) => (
                  <li key={p.code} className='flex items-start justify-between gap-4 border-b pb-2 last:border-0'>
                    <span className='text-sm break-words'>{p.message}</span>
                    <span className='text-sm font-semibold text-destructive'>−{p.points}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='mt-4 text-sm text-muted-foreground'>No active penalties. Pipeline is healthy.</p>
            )}
          </CardContent>
        </Card>

        {/* Watchdog alerts */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Watchdog Alerts</CardTitle>
            <CardDescription>Actionable pipeline violations, refreshed every minute</CardDescription>
          </CardHeader>
          <CardContent>
            {(watchdog.data?.violations ?? []).length === 0 ? (
              <p className='text-sm text-muted-foreground'>No violations. All quiet.</p>
            ) : (
              <ul className='space-y-2'>
                {watchdog.data?.violations.map((v) => (
                  <li
                    key={v.code}
                    className={`flex items-start gap-3 rounded-md border p-2.5 ${
                      v.severity === 'critical'
                        ? 'border-destructive/40 bg-destructive/5'
                        : v.severity === 'warning'
                          ? 'border-amber-400/50 bg-amber-50'
                          : 'border-border bg-muted/30'
                    }`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        v.severity === 'critical'
                          ? 'bg-destructive text-white'
                          : v.severity === 'warning'
                            ? 'bg-amber-500 text-white'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {v.severity}
                    </span>
                    <p className='text-sm'>{v.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* EMQ + dispatch quality (Wave-2.4) */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>EMQ & Dispatch Quality</CardTitle>
          <CardDescription>
            Dispatch health over the window — dedup/retry rates, replays, and the EMQ match-key proxy
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4'>
            <div>
              <p className='text-sm text-muted-foreground'>Dedup rate</p>
              <p className='text-2xl font-bold'>
                {((quality.data?.quality.dedupRate ?? 0) * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>Retry rate</p>
              <p
                className={`text-2xl font-bold ${
                  (quality.data?.quality.retryRate ?? 0) > 0.2 ? 'text-amber-600' : ''
                }`}
              >
                {((quality.data?.quality.retryRate ?? 0) * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>Replayed</p>
              <p className='text-2xl font-bold'>{quality.data?.quality.replayed ?? 0}</p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>FAILED / DEAD</p>
              <p className='text-2xl font-bold'>
                {quality.data?.quality.failed ?? 0} / {quality.data?.quality.dead ?? 0}
              </p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>EMQ match-key gap</p>
              <p
                className={`text-2xl font-bold ${
                  (quality.data?.quality.emq.noEmPhShare ?? 0) >= 0.5 ? 'text-amber-600' : ''
                }`}
              >
                {((quality.data?.quality.emq.noEmPhShare ?? 0) * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>EMQ-flagged dispatches</p>
              <p className='text-2xl font-bold'>{quality.data?.quality.emq.qualityFlagged ?? 0}</p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>Sent</p>
              <p className='text-2xl font-bold'>{quality.data?.quality.sent ?? 0}</p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>Windowed dispatches</p>
              <p className='text-2xl font-bold'>{quality.data?.quality.windowedDispatches ?? 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

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
            <CardTitle>Identifier Usage</CardTitle>
            <CardDescription>event_id + TrackingContext availability (context counts, not Meta dedup)</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className='space-y-2'>
              {(dedup.data?.keyUsage ?? []).map((row) => (
                <li key={row.key} className='flex items-center justify-between border-b pb-2 last:border-0'>
                  <span className='text-sm font-mono'>{DEDUP_KEY_LABELS[row.key] ?? row.key}</span>
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
