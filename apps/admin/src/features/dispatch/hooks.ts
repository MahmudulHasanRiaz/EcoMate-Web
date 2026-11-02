import { useRef, useState } from 'react'
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

export function useDispatchMetrics(params?: any) {
  return useQuery({
    queryKey: ['dispatch-metrics', params],
    queryFn: () => dispatchApi.getMetrics(params).then((r) => r.data),
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

/**
 * Per-courier sync batch sizes (owner requirement, 2026-11-02): one
 * user action may sync hundreds of rows, but the calls underneath are
 * paced per courier so no courier's rate limit is hammered — Steadfast
 * stays at the conservative 10, the others take larger batches, and a
 * short pause separates consecutive batches to the same courier.
 */
export const COURIER_SYNC_BATCH_SIZES: Record<string, number> = {
  steadfast: 10,
  pathao: 25,
  redx: 25,
  carrybee: 25,
}
export const COURIER_SYNC_BATCH_DELAY_MS = 350

export type DispatchSyncEntry = { id: string; courier: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function syncDispatchesInBatches(
  entries: (string | DispatchSyncEntry)[],
  call: (batch: string[]) => Promise<{ data: DispatchSyncSummary }> = (batch) =>
    dispatchApi.syncStatus(batch),
  onProgress?: (done: number, total: number) => void,
  shouldContinue?: () => boolean,
): Promise<DispatchSyncSummary> {
  const normalized: DispatchSyncEntry[] = entries.map((e) =>
    typeof e === 'string' ? { id: e, courier: '' } : e,
  )
  const merged: DispatchSyncSummary = {
    total: normalized.length,
    synced: [],
    unchanged: [],
    failed: [],
  }
  // Group by courier, preserving first-seen courier order.
  const byCourier = new Map<string, string[]>()
  for (const e of normalized) {
    const list = byCourier.get(e.courier) ?? []
    list.push(e.id)
    byCourier.set(e.courier, list)
  }

  let done = 0
  let firstChunk = true
  let cancelled = false
  for (const [courier, ids] of byCourier) {
    const size = COURIER_SYNC_BATCH_SIZES[courier] ?? DISPATCH_SYNC_BATCH_SIZE
    for (let i = 0; i < ids.length; i += size) {
      if (cancelled || (shouldContinue && !shouldContinue())) {
        cancelled = true
        for (const id of ids.slice(i)) {
          merged.failed.push({ id, reason: 'Cancelled' })
        }
        done = merged.synced.length + merged.unchanged.length + merged.failed.length
        onProgress?.(done, normalized.length)
        break
      }
      if (!firstChunk) await sleep(COURIER_SYNC_BATCH_DELAY_MS)
      firstChunk = false
      const batch = ids.slice(i, i + size)
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
      done += batch.length
      onProgress?.(done, normalized.length)
    }
    if (cancelled) {
      // Mark every not-yet-started courier's ids as cancelled too.
      let skipped = false
      for (const [c, ids] of byCourier) {
        if (c === courier) {
          skipped = true
          continue
        }
        if (skipped) {
          for (const id of ids) merged.failed.push({ id, reason: 'Cancelled' })
        }
      }
      onProgress?.(normalized.length, normalized.length)
      break
    }
  }
  return merged
}

export function useDispatchSync() {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const cancelRef = useRef(false)

  const mutation = useMutation({
    mutationFn: async (entries: DispatchSyncEntry[]) => {
      cancelRef.current = false
      setProgress({ done: 0, total: entries.length })
      try {
        return await syncDispatchesInBatches(
          entries,
          undefined,
          (done, total) => setProgress({ done, total }),
          () => !cancelRef.current,
        )
      } finally {
        setProgress(null)
      }
    },
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

  return {
    ...mutation,
    progress,
    cancel: () => {
      cancelRef.current = true
    },
  }
}
