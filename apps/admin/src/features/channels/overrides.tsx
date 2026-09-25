import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { handleServerError } from '@/lib/handle-server-error'
import { shortHash } from './sync-api'
import { useSyncOverrides, useForceEcoMate, useKeepExternal, useRetryOverrides } from './sync-hooks'

/**
 * Overrides view (§11): per field EcoMate value, external value, baseline
 * value, ownership, evidence (plugin/inferred), last pushed — with Force
 * EcoMate Value and Keep External Value. Only an explicit, audited operator
 * action resolves a drift (BR-04); retries never resolve (BR-26).
 */
export function SyncOverrides({ storeId }: { storeId?: string }) {
  const { data: rows, refetch } = useSyncOverrides(storeId)
  const forceMut = useForceEcoMate()
  const keepMut = useKeepExternal()
  const retryMut = useRetryOverrides()
  const [confirm, setConfirm] = useState<{ storeId: string; productId: string; field: string; mode: 'reset' | 'keep' } | null>(null)

  const act = (storeId: string, productId: string, field: string, mode: 'reset' | 'keep') => {
    const mut = mode === 'reset' ? forceMut : keepMut
    mut.mutate(
      { storeId, productId, fields: [field] },
      {
        onSuccess: () => {
          toast.success(mode === 'reset' ? 'EcoMate value forced' : 'External value kept (baseline rebased)')
          void refetch()
        },
        onError: handleServerError,
      },
    )
  }

  return (
    <>
      <Card>
        <CardContent className="space-y-2 pt-4">
          {(rows ?? []).map((row) => (
            <div key={row.id} className="border-b py-2 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={row.ownership === 'CONFLICT' ? 'destructive' : 'outline'}>{row.ownership}</Badge>
                <span className="text-sm font-medium">{row.field}</span>
                <Badge variant="secondary">{row.evidence === 'PLUGIN' ? 'plugin evidence' : 'inferred evidence'}</Badge>
                <span className="text-xs text-muted-foreground">product {row.productId.slice(0, 8)}…</span>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <span>External: <code>{shortHash(row.externalHash)}</code></span>
                <span>Baseline: <code>{shortHash(row.baselineHash)}</code></span>
                <span>Last pushed: {row.lastPushedAt ? new Date(row.lastPushedAt).toLocaleString() : '—'}</span>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirm({ storeId: row.storeId, productId: row.productId, field: row.field, mode: 'reset' })}>
                  Force EcoMate Value
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm({ storeId: row.storeId, productId: row.productId, field: row.field, mode: 'keep' })}>
                  Keep External Value
                </Button>
              </div>
            </div>
          ))}
          {(rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">No pending overrides — every field agrees with EcoMate.</p>}
        </CardContent>
      </Card>
      {(rows ?? []).length > 0 && (
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          disabled={retryMut.isPending}
          onClick={() =>
            retryMut.mutate((rows ?? []).map((r) => r.id), {
              onSuccess: (res: unknown) => {
                toast.success(`Re-evaluated ${(res as { requeued: number }).requeued} overrides (nothing auto-resolved)`)
                void refetch()
              },
              onError: handleServerError,
            })
          }
        >
          Re-evaluate all (never auto-resolves)
        </Button>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => { if (!open) setConfirm(null) }}
        title={confirm?.mode === 'reset' ? 'Force EcoMate Value?' : 'Keep External Value?'}
        desc={
          confirm?.mode === 'reset'
            ? `This overwrites the store's local "${confirm?.field}" with EcoMate's value. The action is audited.`
            : `This rebases the baseline to the store's "${confirm?.field}" value. A later EcoMate edit will push normally. The action is audited.`
        }
        confirmText={confirm?.mode === 'reset' ? 'Force EcoMate Value' : 'Keep External Value'}
        handleConfirm={() => {
          if (confirm) act(confirm.storeId, confirm.productId, confirm.field, confirm.mode)
          setConfirm(null)
        }}
      />
    </>
  )
}
