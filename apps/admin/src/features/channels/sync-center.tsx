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
import { runStatusTone, failureSummary, syncApi, type SyncRunResponse } from './sync-api'
import { useSyncRuns, useSyncRunDetail, useSyncIssues, useSyncOverrides, useSyncAll } from './sync-hooks'
import { SyncOverrides } from './overrides'

function formatDuration(run: SyncRunResponse): string {
  if (!run.finishedAt) return 'running…'
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Sync Center (§11): Overview | History | Product Sync | Failed & Retry |
 * Issues | Overrides. Default History view shows only Status | Store | Type
 * | Trigger | Started | Duration; failures lead with a business sentence +
 * primary action; technical detail is expandable; capability limitations
 * render as informational rows, never failures.
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
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="product">Product Sync</TabsTrigger>
            <TabsTrigger value="retry">Failed &amp; Retry</TabsTrigger>
            <TabsTrigger value="issues">Issues{(issues?.length ?? 0) > 0 ? ` (${issues?.length})` : ''}</TabsTrigger>
            <TabsTrigger value="overrides">Overrides{(overrides?.length ?? 0) > 0 ? ` (${overrides?.length})` : ''}</TabsTrigger>
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

function FailedRetry({ onDone }: { onDone: () => void }) {
  const { data: runs } = useSyncRuns()
  const failed = (runs ?? []).filter((r) => r.status === 'FAILED' || r.status === 'PARTIAL')
  if (failed.length === 0) return <p className="text-sm text-muted-foreground">No failed runs.</p>
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        {failed.map((run) => (
          <div key={run.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
            <Badge variant="destructive">{run.status}</Badge>
            <span className="text-sm">{run.scope} · {new Date(run.startedAt).toLocaleString()}</span>
            <span className="text-sm text-muted-foreground">failed {run.failedCount}/{run.totalCount}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                syncApi.cancelRun(run.id).then(() => { toast.success('Run cancelled'); onDone() }).catch(handleServerError)
              }
            >
              Cancel run
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function IssueRow({ issue }: { issue: { id: string; code: string; message: string; occurrences: number; field?: string | null } }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
      <Badge variant="outline">{issue.code}</Badge>
      {issue.field && <Badge variant="secondary">{issue.field}</Badge>}
      <span className="text-sm">{issue.message}</span>
      <span className="text-sm text-muted-foreground">×{issue.occurrences}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => syncApi.resolveIssue(issue.id).then(() => toast.success('Issue resolved')).catch(handleServerError)}
      >
        Resolve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => syncApi.ignoreIssue(issue.id).then(() => toast.success('Issue ignored')).catch(handleServerError)}
      >
        Ignore
      </Button>
    </div>
  )
}

/** sync-run-detail Sheet: summary + timeline + counts + items + errors (+widened window). */
export function SyncRunDetail({ runId }: { runId: string }) {
  const { data: run } = useSyncRunDetail(runId)
  if (!run) return <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2">
        <Badge variant={runStatusTone(run.status) as never}>{run.status}</Badge>
        <span className="text-sm">{run.scope} · {run.triggerType}</span>
      </div>
      {run.windowDays != null && (
        <p className="text-sm text-muted-foreground">
          Window: {run.windowDays} days{run.wideningReason ? ` — ${run.wideningReason}` : ''}
        </p>
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
