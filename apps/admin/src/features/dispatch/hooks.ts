import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dispatchApi } from './api'
import type { DispatchSyncSummary } from './api'
import { formatCourierDispatchToast } from './courier-errors'

export function useDispatchList(params?: any) {
  return useQuery({
    queryKey: ['dispatches', params],
    queryFn: () => dispatchApi.list(params).then((r) => r.data),
  })
}

export function useDispatchMetrics() {
  return useQuery({
    queryKey: ['dispatch-metrics'],
    queryFn: () => dispatchApi.getMetrics().then((r) => r.data),
    refetchInterval: 30000,
  })
}

export function useDispatchMutations() {
  const qc = useQueryClient()

  return {
    create: useMutation({
      mutationFn: dispatchApi.create,
      onSuccess: () => {
        toast.success('Dispatch created')
        qc.invalidateQueries({ queryKey: ['dispatches'] })
      },
      // Fix 5: thread server field errors (message + errors object) into the
      // toast with exact field+rule naming, same as courier dispatch paths.
      onError: (e: any) => {
        const d = e?.response?.data
        toast.error(
          formatCourierDispatchToast({
            message: d?.message || 'Failed to create dispatch',
            errors: d?.errors,
          }),
          { duration: 8000 },
        )
      },
    }),
    updateStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: string }) =>
        dispatchApi.updateStatus(id, status),
      onSuccess: () => {
        toast.success('Status updated')
        qc.invalidateQueries({ queryKey: ['dispatches'] })
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.message || 'Failed to update dispatch status'),
    }),
    remove: useMutation({
      mutationFn: dispatchApi.remove,
      onSuccess: () => {
        toast.success('Dispatch deleted')
        qc.invalidateQueries({ queryKey: ['dispatches'] })
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.message || 'Failed to delete dispatch'),
    }),
    confirmPanelCancel: useMutation({
      mutationFn: (id: string) => dispatchApi.confirmPanelCancel(id),
      onSuccess: () => {
        toast.success('Panel cancellation confirmed')
        qc.invalidateQueries({ queryKey: ['dispatches'] })
        qc.invalidateQueries({ queryKey: ['order'] })
      },
      onError: (e: any) =>
        toast.error(
          e?.response?.data?.message || 'Failed to confirm panel cancellation',
        ),
    }),
  }
}

/**
 * Bulk courier sync runs in sequential batches (owner report 2026-10-30:
 * syncing 50-60 marked dispatches at once "failed" most of them). The
 * backend handles ONE request's ids sequentially with a live courier call
 * per dispatch, so a single 60-id request cannot finish inside any sane
 * client timeout. Batches of 10 keep each request comfortably inside its
 * (raised) timeout; the summaries merge into one result for the toast.
 * A batch whose REQUEST fails (timeout/network) does not stop the rest —
 * its ids are counted as failed-to-confirm and the refreshed list shows
 * the true states.
 */
export const DISPATCH_SYNC_BATCH_SIZE = 10

export async function syncDispatchesInBatches(
  ids: string[],
  call: (batch: string[]) => Promise<{ data: DispatchSyncSummary }> = (batch) =>
    dispatchApi.syncStatus(batch),
): Promise<DispatchSyncSummary> {
  const merged: DispatchSyncSummary = {
    total: ids.length,
    synced: [],
    unchanged: [],
    failed: [],
  }
  for (let i = 0; i < ids.length; i += DISPATCH_SYNC_BATCH_SIZE) {
    const batch = ids.slice(i, i + DISPATCH_SYNC_BATCH_SIZE)
    try {
      const res = await call(batch)
      merged.synced.push(...res.data.synced)
      merged.unchanged.push(...res.data.unchanged)
      merged.failed.push(...res.data.failed)
    } catch {
      for (const id of batch) {
        merged.failed.push({ id, reason: 'Sync request failed' })
      }
    }
  }
  return merged
}

export function useDispatchSync() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => syncDispatchesInBatches(ids),
    onSuccess: (summary) => {
      const parts = [
        `${summary.synced.length} synced`,
        `${summary.unchanged.length} unchanged`,
      ]
      if (summary.failed.length) {
        parts.push(`${summary.failed.length} failed`)
        toast.warning(`Courier sync: ${parts.join(' · ')}`)
      } else {
        toast.success(`Courier sync: ${parts.join(' · ')}`)
      }
      qc.invalidateQueries({ queryKey: ['dispatches'] })
      qc.invalidateQueries({ queryKey: ['dispatch-metrics'] })
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Failed to sync courier status'),
  })
}
