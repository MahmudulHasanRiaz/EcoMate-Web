import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { monitoringApi, type DispatchFunnel, type DateRangeParams } from './monitoring-api'
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

/** Date range presets for the monitoring dashboard. */
const PRESETS = [
  { key: 'today' as const, label: 'Today' },
  { key: 'yesterday' as const, label: 'Yesterday' },
  { key: 'last7days' as const, label: 'Last 7 Days' },
]

/**
 * Tracking monitoring dashboard (Phase 6, design §14). Read-only aggregate views
 * over the CAPI tracking pipeline served by the backend monitoring endpoints.
 * Every section is a TanStack Query over the same admin API; the timeline is a
 * search-driven query keyed on the submitted event/order ID.
 */
export function TrackingMonitoring() {
  // Date range state
  const [dateRange, setDateRange] = useState<DateRangeParams>({ preset: 'today' })
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const applyCustomRange = () => {
    if (customFrom && customTo) {
      setDateRange({ from: customFrom, to: customTo })
    }
  }

  // Include date range in query keys for correct refetching
  const rangeKey = dateRange.preset || `${dateRange.from}-${dateRange.to}`

  const overview = useQuery({
    queryKey: ['tracking-monitoring', 'overview', rangeKey],
    queryFn: () => monitoringApi.overview(dateRange),
  })
  const failures = useQuery({
    queryKey: ['tracking-monitoring', 'failures'],
    queryFn: () => monitoringApi.failures(),
  })
  const freshness = useQuery({
    queryKey: ['tracking-monitoring', 'freshness', rangeKey],
    queryFn: () => monitoringApi.freshness(dateRange),
  })
  const dedup = useQuery({
    queryKey: ['tracking-monitoring', 'dedup', rangeKey],
    queryFn: () => monitoringApi.dedup(dateRange),
  })
  const health = useQuery({
    queryKey: ['tracking-monitoring', 'health'],
    queryFn: () => monitoringApi.health(),
    refetchInterval: 60_000,
  })
  const mirrorCapture = useQuery({
    queryKey: ['tracking-monitoring', 'mirror-capture', rangeKey],
    queryFn: () => monitoringApi.mirrorCapture(dateRange),
  })
  const quality = useQuery({
    queryKey: ['tracking-monitoring', 'quality', rangeKey],
    queryFn: () => monitoringApi.quality(dateRange),
  })
  const coverage = useQuery({
    queryKey: ['tracking-monitoring', 'coverage', rangeKey],
    queryFn: () => monitoringApi.coverage(dateRange),
  })
  const watchdog = useQuery({
    queryKey: ['tracking-monitoring', 'watchdog', rangeKey],
    queryFn: () => monitoringApi.watchdog(dateRange),
    refetchInterval: 60_000,
  })
  const healthScore = useQuery({
    queryKey: ['tracking-monitoring', 'health-score', rangeKey],
    queryFn: () => monitoringApi.healthScore(dateRange),
    refetchInterval: 60_000,
  })
  const reconciliation = useQuery({
    queryKey: ['tracking-monitoring', 'reconciliation', rangeKey],
    queryFn: () => monitoringApi.purchaseReconciliation(dateRange),
  })

  const [eventIdInput, setEventIdInput] = useState('')
  const [searchedEventId, setSearchedEventId] = useState<string | null>(null)
  const timeline = useQuery({
    queryKey: ['tracking-monitoring', 'timeline', searchedEventId],
    queryFn: () => monitoringApi.timeline(searchedEventId!),
    enabled: !!searchedEventId,
  })

  const activeRangeLabel = useMemo(() => {
    if (dateRange.preset) {
      return PRESETS.find((p) => p.key === dateRange.preset)?.label ?? dateRange.preset
    }
    if (dateRange.from && dateRange.to) {
      return dateRange.from === dateRange.to ? dateRange.from : `${dateRange.from} – ${dateRange.to}`
    }
    return 'Today'
  }, [dateRange])

  if (overview.isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[400px]'>
        <Loader2 className='animate-spin h-8 w-8 text-primary' />
      </div>
    )
  }

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='flex items-start justify-between gap-4'>
        <div className='space-y-0.5'>
          <h2 className='text-2xl font-bold tracking-tight'>Tracking Monitoring</h2>
          <p className='text-muted-foreground'>
            Aggregate views over the CAPI tracking pipeline.
          </p>
        </div>
      </div>

      {/* Date range selector */}
      <Card>
        <CardContent className='pt-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <Calendar className='h-4 w-4 text-muted-foreground' />
            <span className='text-sm font-medium'>Date Range:</span>
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                variant={dateRange.preset === p.key ? 'default' : 'outline'}
                size='sm'
                onClick={() => setDateRange({ preset: p.key })}
              >
                {p.label}
              </Button>
            ))}
            <div className='flex items-center gap-1 ml-2'>
              <Input
                type='date'
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className='w-36 h-8 text-xs'
                placeholder='Start date'
              />
              <span className='text-xs text-muted-foreground'>to</span>
              <Input
                type='date'
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className='w-36 h-8 text-xs'
                placeholder='End date'
              />
              <Button
                variant='outline'
                size='sm'
                onClick={applyCustomRange}
                disabled={!customFrom || !customTo}
              >
                Apply
              </Button>
            </div>
            <span className='text-sm text-muted-foreground ml-2'>
              Active: <span className='font-semibold'>{activeRangeLabel}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      <TrackingTabs />
      <Separator className='my-6' />

      {/* Business ↔ Tracking Reconciliation */}
      <Card className='border-primary/20'>
        <CardHeader className='pb-3'>
          <CardTitle>Business ↔ Tracking Reconciliation</CardTitle>
          <CardDescription>
            Configuration-aware waterfall for {activeRangeLabel}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reconciliation.isLoading ? (
            <Loader2 className='animate-spin h-5 w-5 text-primary' />
          ) : reconciliation.data ? (
            <div className='space-y-6'>
              {/* Business Orders */}
              <div>
                <h4 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3'>Business Orders</h4>
                <div className='grid grid-cols-3 gap-4'>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>New</p>
                    <p className='text-2xl font-bold'>{reconciliation.data.reconciliation.newOrders}</p>
                  </div>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>Confirmed</p>
                    <p className='text-2xl font-bold'>{reconciliation.data.reconciliation.confirmedOrders}</p>
                  </div>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>Delivered</p>
                    <p className='text-2xl font-bold'>{reconciliation.data.reconciliation.deliveredOrders}</p>
                  </div>
                </div>
              </div>

              {/* Source / Configuration */}
              <div>
                <h4 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3'>Source / Configuration</h4>
                <div className='grid grid-cols-2 gap-4 md:grid-cols-4 mb-3'>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>Website</p>
                    <p className='text-xl font-bold'>{reconciliation.data.reconciliation.confirmedBySource.DIRECT_WEBSITE}</p>
                    <p className='text-xs text-emerald-600'>ON</p>
                  </div>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>POS</p>
                    <p className='text-xl font-bold'>{reconciliation.data.reconciliation.confirmedBySource.POS}</p>
                    <p className='text-xs text-red-600'>OFF</p>
                  </div>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>Incomplete</p>
                    <p className='text-xl font-bold'>{reconciliation.data.reconciliation.confirmedBySource.INCOMPLETE_CONVERSION}</p>
                    <p className='text-xs text-red-600'>OFF</p>
                  </div>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>Manual</p>
                    <p className='text-xl font-bold'>{reconciliation.data.reconciliation.confirmedBySource.MANUAL}</p>
                    <p className='text-xs text-red-600'>OFF</p>
                  </div>
                </div>
                <div className='grid grid-cols-3 gap-4'>
                  <div className='rounded-md border border-emerald-200 bg-emerald-50 p-3'>
                    <p className='text-sm text-emerald-700'>Eligible for Tracking</p>
                    <p className='text-2xl font-bold text-emerald-700'>{reconciliation.data.reconciliation.eligibleConfirmed}</p>
                  </div>
                  <div className='rounded-md border border-muted p-3'>
                    <p className='text-sm text-muted-foreground'>Configuration Excluded</p>
                    <p className='text-2xl font-bold'>{reconciliation.data.reconciliation.configExcludedConfirmed}</p>
                    <p className='text-xs text-muted-foreground'>Intentional skip</p>
                  </div>
                  <div className='rounded-md border border-primary/30 p-3'>
                    <p className='text-sm font-medium'>Expected Purchase</p>
                    <p className='text-2xl font-bold'>{reconciliation.data.reconciliation.expectedPurchases}</p>
                    <p className='text-xs text-muted-foreground'>
                      Mode: {reconciliation.data.reconciliation.metaPurchaseMode}
                      {reconciliation.data.reconciliation.metaValidatedStatus
                        ? ` (${reconciliation.data.reconciliation.metaValidatedStatus})`
                        : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tracking Result */}
              <div>
                <h4 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3'>Tracking Result</h4>
                <div className='grid grid-cols-2 gap-4 md:grid-cols-5'>
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>Canonical Purchase</p>
                    <p className='text-2xl font-bold'>{reconciliation.data.reconciliation.canonicalPurchases}</p>
                  </div>
                  <div className='rounded-md border border-emerald-200 bg-emerald-50 p-3'>
                    <p className='text-sm text-emerald-700'>Matched</p>
                    <p className='text-2xl font-bold text-emerald-700'>{reconciliation.data.reconciliation.matchedPurchases}</p>
                  </div>
                  {(() => {
                    const hasUnexpected = reconciliation.data.reconciliation.unexpectedPurchases > 0
                    return (
                      <div className={hasUnexpected ? 'rounded-md border border-amber-300 bg-amber-50 p-3' : 'rounded-md border p-3'}>
                        <p className={hasUnexpected ? 'text-sm text-amber-700 font-semibold' : 'text-sm text-muted-foreground'}>Unexpected</p>
                        <p className={hasUnexpected ? 'text-2xl font-bold text-amber-700' : 'text-2xl font-bold'}>{reconciliation.data.reconciliation.unexpectedPurchases}</p>
                        {hasUnexpected && <p className='text-xs text-amber-600 font-semibold'>ANOMALY</p>}
                      </div>
                    )
                  })()}
                  <div className='rounded-md border p-3'>
                    <p className='text-sm text-muted-foreground'>Deduped</p>
                    <p className='text-2xl font-bold'>{reconciliation.data.reconciliation.dedupedPurchases}</p>
                  </div>
                </div>
              </div>

              {/* Provider Delivery */}
              {reconciliation.data.reconciliation.providerReconciliation.length > 0 && (
                <div>
                  <h4 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3'>Provider Delivery</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Expected</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Pending</TableHead>
                        <TableHead>Failed</TableHead>
                        <TableHead>Skipped</TableHead>
                        <TableHead>Missing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconciliation.data.reconciliation.providerReconciliation.map((p) => (
                        <TableRow key={p.provider}>
                          <TableCell className='font-medium'>{p.provider}</TableCell>
                          <TableCell>{p.expected}</TableCell>
                          <TableCell>{p.sent}</TableCell>
                          <TableCell>{p.pending}</TableCell>
                          <TableCell>{p.failed}</TableCell>
                          <TableCell>{p.skipped}</TableCell>
                          <TableCell className={p.missing > 0 ? 'text-red-600 font-semibold' : ''}>{p.missing}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Trigger Mode Breakdown */}
              <div>
                <h4 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3'>Trigger Mode</h4>
                <div className='grid grid-cols-2 gap-4 md:grid-cols-5'>
                  <div className='rounded-md border p-2 text-center'>
                    <p className='text-xs text-muted-foreground'>Instant</p>
                    <p className='text-lg font-semibold'>{reconciliation.data.reconciliation.instantPurchases}</p>
                  </div>
                  <div className='rounded-md border p-2 text-center'>
                    <p className='text-xs text-muted-foreground'>Validated</p>
                    <p className='text-lg font-semibold'>{reconciliation.data.reconciliation.validatedPurchases}</p>
                  </div>
                  <div className='rounded-md border p-2 text-center'>
                    <p className='text-xs text-muted-foreground'>Offline</p>
                    <p className='text-lg font-semibold'>{reconciliation.data.reconciliation.offlinePurchases}</p>
                  </div>
                  <div className='rounded-md border p-2 text-center'>
                    <p className='text-xs text-muted-foreground'>Browser</p>
                    <p className='text-lg font-semibold'>{reconciliation.data.reconciliation.browserPurchases}</p>
                  </div>
                  <div className='rounded-md border p-2 text-center'>
                    <p className='text-xs text-muted-foreground'>Replayed</p>
                    <p className='text-lg font-semibold'>{reconciliation.data.reconciliation.replayedEvents}</p>
                  </div>
                </div>
              </div>

              {/* Anomaly Drill-down */}
              {(reconciliation.data.reconciliation.missingOrderIds.length > 0 ||
                reconciliation.data.reconciliation.unexpectedOrderIds.length > 0 ||
                reconciliation.data.reconciliation.configExcludedOrderIds.length > 0) && (
                <div>
                  <h4 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3'>Drill-down</h4>
                  <div className='space-y-3'>
                    {reconciliation.data.reconciliation.missingOrderIds.length > 0 && (
                      <div className='rounded-md border border-red-200 bg-red-50 p-3'>
                        <p className='text-sm font-semibold text-red-700 mb-2'>
                          Missing Eligible Purchase ({reconciliation.data.reconciliation.missingOrderIds.length})
                        </p>
                        <div className='flex flex-wrap gap-1'>
                          {reconciliation.data.reconciliation.missingOrderIds.slice(0, 20).map((id) => (
                            <code key={id} className='text-xs bg-red-100 px-1.5 py-0.5 rounded'>{id}</code>
                          ))}
                          {reconciliation.data.reconciliation.missingOrderIds.length > 20 && (
                            <span className='text-xs text-red-600'>+{reconciliation.data.reconciliation.missingOrderIds.length - 20} more</span>
                          )}
                        </div>
                      </div>
                    )}
                    {reconciliation.data.reconciliation.unexpectedOrderIds.length > 0 && (
                      <div className='rounded-md border border-amber-200 bg-amber-50 p-3'>
                        <p className='text-sm font-semibold text-amber-700 mb-2'>
                          Unexpected Purchase ({reconciliation.data.reconciliation.unexpectedOrderIds.length})
                        </p>
                        <div className='flex flex-wrap gap-1'>
                          {reconciliation.data.reconciliation.unexpectedOrderIds.slice(0, 20).map((id) => (
                            <code key={id} className='text-xs bg-amber-100 px-1.5 py-0.5 rounded'>{id}</code>
                          ))}
                        </div>
                      </div>
                    )}
                    {reconciliation.data.reconciliation.configExcludedOrderIds.length > 0 && (
                      <div className='rounded-md border p-3'>
                        <p className='text-sm font-semibold text-muted-foreground mb-2'>
                          Configuration Excluded ({reconciliation.data.reconciliation.configExcludedOrderIds.length})
                        </p>
                        <div className='flex flex-wrap gap-1'>
                          {reconciliation.data.reconciliation.configExcludedOrderIds.slice(0, 20).map((item) => (
                            <code key={item.orderId} className='text-xs bg-muted px-1.5 py-0.5 rounded'>
                              {item.orderId} ({item.source})
                            </code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>No reconciliation data available.</p>
          )}
        </CardContent>
      </Card>

      <div className='grid gap-4 md:grid-cols-2'>
        {/* Volume by event type */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Volume by Event Type</CardTitle>
            <CardDescription>Snapshots captured in {activeRangeLabel}</CardDescription>
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
            <CardDescription>Current runtime state (not windowed)</CardDescription>
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
              <p className='text-sm text-muted-foreground'>Deduped captures</p>
              <p className='text-2xl font-bold'>
                {quality.data?.quality.dedupedCaptures ?? 0}
              </p>
              <p className='text-xs text-muted-foreground'>
                of {(quality.data?.quality.capturedSnapshots ?? 0)} captured
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

      {/* Identity & context coverage (incident follow-up, 2026-08-10) */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Identity & Context Coverage</CardTitle>
          <CardDescription>
            Share of captures carrying each match/context field (payload paths +
            context columns) — the server-side truth behind Meta EMQ coverage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Base</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Coverage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coverage.data?.identityCoverage.map((row) => (
                <TableRow key={`${row.base}-${row.field}`}>
                  <TableCell className='font-medium'>{row.field}</TableCell>
                  <TableCell>{row.base}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell>{row.total}</TableCell>
                  <TableCell>
                    <span
                      className={
                        row.coverage >= 0.75
                          ? 'text-green-600'
                          : row.coverage >= 0.25
                            ? 'text-amber-600'
                            : 'text-red-600'
                      }
                    >
                      {(row.coverage * 100).toFixed(1)}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {(coverage.data?.identityCoverage ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className='text-muted-foreground'>
                    No captures in the window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Per-provider dispatch funnel */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Dispatch Funnel</CardTitle>
          <CardDescription>Per-provider dispatch state for {activeRangeLabel}</CardDescription>
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
