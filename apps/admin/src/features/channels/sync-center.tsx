import { useState } from 'react'
import { RefreshCw, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { handleServerError } from '@/lib/handle-server-error'
import { capabilityNotices } from './api'
import { useStores } from './hooks'
import {
  runStatusTone,
  failureSummary,
  isAttemptEligibleUi,
  syncApi,
  type SyncRunResponse,
  type SyncAttemptResponse,
} from './sync-api'
import {
  useSyncRuns,
  useSyncRunDetail,
  useSyncIssues,
  useSyncOverrides,
  useSyncAll,
  useSyncAttempts,
  useStoreHealthGrid,
  useOverridesHistory,
  useRetentionStatus,
  useRetryAttempt,
  useRetryAttempts,
  useRetryAllAttempts,
  useIgnoreAttempt,
  useResolveIssue,
  useTriggerRetentionPurge,
} from './sync-hooks'
import { SyncOverrides } from './overrides'

function formatDuration(run: SyncRunResponse): string {
  if (!run.finishedAt) return 'running…'
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Sync Center (§11 + P11 operations): Overview | History | Product Sync |
 * Failed & Retry | Issues | Overrides | Audit. Default History view shows
 * only Status | Store | Type | Trigger | Started | Duration; failures lead
 * with a business sentence + primary action; technical detail is
 * expandable; capability limitations render as informational rows, never
 * failures. P11 adds: attempt-level retry now/selected/all-eligible +
 * ignore-with-note, issue resolve/ignore with notes, store health grid,
 * override audit history, retention status, widened-window visibility.
 */
export function SyncCenter() {
  const [tab, setTab] = useState('history')
  const [detailId, setDetailId] = useState<string | null>(null)
  const { data: runs, refetch } = useSyncRuns()
  const { data: stores } = useStores()
  const { data: issues } = useSyncIssues('OPEN')
  const { data: overrides } = useSyncOverrides()
  const syncAllMut = useSyncAll()
  const storeName = (id?: string | null) => stores?.find((s) => s.id === id)?.name ?? id ?? '—'

  const onSyncAll = () => {
    syncAllMut.mutate(undefined, {
      onSuccess: (res: unknown) => {
        const r = res as { childRunIds: string[]; excludedNativeCount: number }
        toast.success(`Sync started on ${r.childRunIds.length} stores (${r.excludedNativeCount} native excluded)`)
        void refetch()
      },
      onError: handleServerError,
    })
  }

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          <h1 className="font-semibold">Sync Center</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={onSyncAll} disabled={syncAllMut.isPending}>
            <Play className="mr-1 h-4 w-4" /> Sync all stores
          </Button>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="product">Product Sync</TabsTrigger>
            <TabsTrigger value="retry">Failed &amp; Retry</TabsTrigger>
            <TabsTrigger value="issues">Issues{(issues?.length ?? 0) > 0 ? ` (${issues?.length})` : ''}</TabsTrigger>
            <TabsTrigger value="overrides">Overrides{(overrides?.length ?? 0) > 0 ? ` (${overrides?.length})` : ''}</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader><CardTitle className="text-base">Active runs</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {(runs ?? []).filter((r) => r.status === 'RUNNING').length}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Open issues</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold">{issues?.length ?? 0}</CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Pending overrides</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold">{overrides?.length ?? 0}</CardContent>
              </Card>
            </div>
            <StoreHealthGrid />
            <RetentionCard />
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Capability notices</CardTitle>
                <CardDescription>Informational rows — consequences, never failures.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(stores ?? []).flatMap((s) =>
                  capabilityNotices(s.capabilities).map((n) => (
                    <div key={`${s.id}-${n}`} className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{s.name}:</span> {n}
                    </div>
                  )),
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardContent className="space-y-2 pt-4">
                {(runs ?? []).map((run) => {
                  const failed = run.status === 'FAILED' || run.status === 'PARTIAL'
                  const summary = failed ? failureSummary(run, storeName(run.storeId)) : null
                  return (
                    <div key={run.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
                      <Badge variant={runStatusTone(run.status) as never}>{run.status}</Badge>
                      <span className="text-sm">{storeName(run.storeId)}</span>
                      <span className="text-sm text-muted-foreground">{run.scope}</span>
                      <span className="text-sm text-muted-foreground">{run.triggerType}</span>
                      <span className="text-sm text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
                      <span className="text-sm text-muted-foreground">{formatDuration(run)}</span>
                      {(run.widenedWindow ?? (run.windowDays != null ? { days: run.windowDays, reason: run.wideningReason } : null)) && (
                        <span className="text-xs text-muted-foreground">
                          window {(run.widenedWindow?.days ?? run.windowDays)}d
                          {(run.widenedWindow?.reason ?? run.wideningReason) ? ` — ${run.widenedWindow?.reason ?? run.wideningReason}` : ''}
                        </span>
                      )}
                      {summary && <span className="w-full text-sm">{summary.sentence} </span>}
                      <Button size="sm" variant="outline" onClick={() => setDetailId(run.id)}>Detail</Button>
                    </div>
                  )
                })}
                {(runs ?? []).length === 0 && <p className="text-sm text-muted-foreground">No sync runs yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="product">
            <Card>
              <CardHeader><CardTitle className="text-base">Product sync per store</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(stores ?? []).filter((s) => s.kind !== 'NATIVE').map((s) => (
                  <div key={s.id} className="flex items-center gap-2 border-b py-2 last:border-0">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-sm text-muted-foreground">last sync {s.lastSyncAt ?? '—'}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        syncApi.triggerStoreSync(s.id).then(() => {
                          toast.success(`Sync started for ${s.name}`)
                          void refetch()
                        }).catch(handleServerError)
                      }
                    >
                      Sync now
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="retry">
            <FailedRetry onDone={() => void refetch()} />
          </TabsContent>

          <TabsContent value="issues">
            <Card>
              <CardContent className="space-y-2 pt-4">
                {(issues ?? []).map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
                {(issues ?? []).length === 0 && <p className="text-sm text-muted-foreground">No open issues.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="overrides">
            <SyncOverrides />
          </TabsContent>

          <TabsContent value="audit">
            <OverrideAudit />
          </TabsContent>
        </Tabs>

        <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null) }}>
          <SheetContent className="w-full sm:max-w-xl">
            <SheetHeader><SheetTitle>Sync run detail</SheetTitle></SheetHeader>
            {detailId && <SyncRunDetail runId={detailId} />}
          </SheetContent>
        </Sheet>
      </Main>
    </>
  )
}

function StoreHealthGrid() {
  const { data: grid } = useStoreHealthGrid()
  if (!grid || grid.length === 0) return null
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Store health</CardTitle>
        <CardDescription>Probe state, open issues and active runs per store (§12).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {grid.map((row) => (
          <div key={row.storeId} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0">
            <Badge variant={row.healthState === 'HEALTHY' ? 'success' as never : row.healthState === 'ERROR' ? 'destructive' : 'warning' as never}>
              {row.healthState}
            </Badge>
            <span className="font-medium">{row.name}</span>
            <span className="text-muted-foreground">{row.provider}</span>
            <span className="text-muted-foreground">open issues {row.openIssues}</span>
            <span className="text-muted-foreground">active runs {row.activeRuns}</span>
            <span className="text-xs text-muted-foreground">
              checked {row.lastHealthCheckAt ? new Date(row.lastHealthCheckAt).toLocaleString() : '—'}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function RetentionCard() {
  const { data: status } = useRetentionStatus()
  const purgeMut = useTriggerRetentionPurge()
  if (!status) return null
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Retention (BR-19)</CardTitle>
        <CardDescription>
          Runs/items {status.policy.syncRunsDays}d · attempts {status.policy.syncAttemptsDays}d · resolved/ignored issues{' '}
          {status.policy.resolvedIgnoredIssuesDays}d · open issues kept compact · deliveries {status.policy.webhookDeliveriesDays}d ·
          health checks {status.policy.healthChecksDays}d.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          Last purge: {status.lastPurgeRun ? `${status.lastPurgeRun.status} · ${new Date(status.lastPurgeRun.startedAt).toLocaleString()}` : '—'}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={purgeMut.isPending}
          onClick={() =>
            purgeMut.mutate(undefined, {
              onSuccess: () => toast.success('Retention purge enqueued'),
              onError: handleServerError,
            })
          }
        >
          Purge now
        </Button>
      </CardContent>
    </Card>
  )
}

function FailedRetry({ onDone }: { onDone: () => void }) {
  const { data: attempts, refetch } = useSyncAttempts()
  const retryOne = useRetryAttempt()
  const retrySel = useRetryAttempts()
  const retryAll = useRetryAllAttempts()
  const ignoreMut = useIgnoreAttempt()
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')

  const eligible = (attempts ?? []).filter((a) => isAttemptEligibleUi(a as SyncAttemptResponse))
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const after = (msg: string) => {
    toast.success(msg)
    setSelected([])
    void refetch()
    onDone()
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={selected.length === 0 || retrySel.isPending}
            onClick={() =>
              retrySel.mutate(selected, {
                onSuccess: (res: unknown) => after(`Retried ${(res as { retried: number }).retried} attempts`),
                onError: handleServerError,
              })
            }
          >
            Retry selected ({selected.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={eligible.length === 0 || retryAll.isPending}
            onClick={() =>
              retryAll.mutate(undefined, {
                onSuccess: (res: unknown) => after(`Retried ${(res as { retried: number }).retried} eligible attempts`),
                onError: handleServerError,
              })
            }
          >
            Retry all eligible ({eligible.length})
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-52 flex-1 rounded border px-2 py-1 text-sm"
            placeholder="Ignore note (recorded on the attempt)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={selected.length === 0 || ignoreMut.isPending}
            onClick={async () => {
              for (const id of selected) {
                await ignoreMut.mutateAsync({ id, note: note || undefined }).catch(handleServerError)
              }
              after(`Ignored ${selected.length} attempts`)
              setNote('')
            }}
          >
            Ignore selected with note
          </Button>
        </div>
        {(attempts ?? []).slice(0, 100).map((a) => {
          const ok = isAttemptEligibleUi(a as SyncAttemptResponse)
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0">
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} aria-label={`select ${a.id}`} />
              <Badge variant={a.status === 'FAILED' || a.status === 'DEAD' ? 'destructive' : 'outline'}>{a.status}</Badge>
              <span className="text-muted-foreground">{a.objectType} · {a.objectKey.slice(0, 48)}</span>
              {a.errorCategory && <span className="text-xs text-muted-foreground">{a.errorCategory}</span>}
              <Button
                size="sm"
                variant="outline"
                disabled={!ok || retryOne.isPending}
                title={ok ? 'Retry now' : 'Not eligible (waiting, terminal or already handled)'}
                onClick={() =>
                  retryOne.mutate(a.id, {
                    onSuccess: () => after('Retry enqueued'),
                    onError: handleServerError,
                  })
                }
              >
                Retry now
              </Button>
            </div>
          )
        })}
        {(attempts ?? []).length === 0 && <p className="text-sm text-muted-foreground">No attempts in the 90-day window.</p>}
      </CardContent>
    </Card>
  )
}

function IssueRow({ issue }: { issue: { id: string; code: string; message: string; occurrences: number; field?: string | null } }) {
  const mut = useResolveIssue()
  const [note, setNote] = useState('')
  const act = (ignore: boolean) =>
    mut.mutate(
      { id: issue.id, note: note || undefined, ignore },
      {
        onSuccess: () => {
          toast.success(ignore ? 'Issue ignored' : 'Issue resolved')
          setNote('')
        },
        onError: handleServerError,
      },
    )
  return (
    <div className="border-b py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{issue.code}</Badge>
        {issue.field && <Badge variant="secondary">{issue.field}</Badge>}
        <span className="text-sm">{issue.message}</span>
        <span className="text-sm text-muted-foreground">×{issue.occurrences}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="min-w-52 flex-1 rounded border px-2 py-1 text-sm"
          placeholder="Resolution note (audited)…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button size="sm" variant="outline" disabled={mut.isPending} onClick={() => act(false)}>
          Resolve with note
        </Button>
        <Button size="sm" variant="ghost" disabled={mut.isPending} onClick={() => act(true)}>
          Ignore with note
        </Button>
      </div>
    </div>
  )
}

function OverrideAudit() {
  const { data: rows } = useOverridesHistory()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Override audit history</CardTitle>
        <CardDescription>Every Force EcoMate Value / Keep External Value with actor and previous state (BR-04).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {(rows ?? []).map((row) => (
          <details key={row.id} className="border-b py-1 text-sm last:border-0">
            <summary className="cursor-pointer">
              <Badge variant="outline" className="mr-2">{row.status}</Badge>
              {row.field ?? row.objectType} · {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
            </summary>
            <p className="mt-1 break-words text-muted-foreground">{row.reason ?? '—'}</p>
          </details>
        ))}
        {(rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">No override actions recorded yet.</p>}
      </CardContent>
    </Card>
  )
}

/** sync-run-detail Sheet: summary + timeline + counts + items + errors (+widened window). */
export function SyncRunDetail({ runId }: { runId: string }) {
  const { data: run } = useSyncRunDetail(runId)
  if (!run) return <p className="text-sm text-muted-foreground">Loading…</p>
  const widened = run.widenedWindow ?? (run.windowDays != null ? { days: run.windowDays, reason: run.wideningReason } : null)
  return (
    <div className="space-y-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={runStatusTone(run.status) as never}>{run.status}</Badge>
        <span className="text-sm">{run.scope} · {run.triggerType}</span>
        {run.provider && <Badge variant="secondary">{run.provider}</Badge>}
      </div>
      {widened && (
        <p className="text-sm text-muted-foreground">
          Window: {widened.days} days{widened.reason ? ` — ${widened.reason}` : ''}
        </p>
      )}
      {run.correlationId && (
        <p className="break-all text-xs text-muted-foreground">correlation {run.correlationId}</p>
      )}
      <div className="grid grid-cols-4 gap-2 text-center">
        {([['Created', run.createdCount], ['Updated', run.updatedCount], ['Skipped', run.skippedCount], ['Failed', run.failedCount]] as const).map(([label, n]) => (
          <Card key={label}><CardContent className="pt-3"><div className="text-xl font-semibold">{n}</div><div className="text-xs text-muted-foreground">{label}</div></CardContent></Card>
        ))}
      </div>
      <div className="space-y-1">
        {(run.items ?? []).map((item) => (
          <details key={item.id} className="border-b py-1 text-sm last:border-0">
            <summary className="cursor-pointer">
              <Badge variant="outline" className="mr-2">{item.status}</Badge>
              {item.objectType}{item.field ? ` · ${item.field}` : ''}
            </summary>
            <p className="mt-1 text-muted-foreground">{item.reason ?? '—'}</p>
          </details>
        ))}
        {(run.items ?? []).length === 0 && <p className="text-sm text-muted-foreground">No items recorded.</p>}
      </div>
    </div>
  )
}
