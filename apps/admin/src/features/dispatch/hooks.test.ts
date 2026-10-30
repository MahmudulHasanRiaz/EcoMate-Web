import { describe, expect, it, vi } from 'vitest'
import { DISPATCH_SYNC_BATCH_SIZE, syncDispatchesInBatches } from './hooks'
import type { DispatchSyncSummary } from './api'

const summary = (
  synced: string[],
  unchanged: string[] = [],
  failed: { id: string; reason: string }[] = [],
): { data: DispatchSyncSummary } => ({
  data: {
    total: synced.length + unchanged.length + failed.length,
    synced: synced.map((id) => ({ id })),
    unchanged: unchanged.map((id) => ({ id })),
    failed,
  },
})

const ids = (n: number) => Array.from({ length: n }, (_, i) => `d-${i + 1}`)

describe('syncDispatchesInBatches — bulk sync chunking (2026-10-30)', () => {
  it('splits a large selection into sequential batches of 10 and merges the summaries', async () => {
    const call = vi.fn(async (batch: string[]) => summary(batch))
    const result = await syncDispatchesInBatches(ids(25), call)

    expect(call).toHaveBeenCalledTimes(3)
    expect(call.mock.calls.map((c) => c[0].length)).toEqual([
      DISPATCH_SYNC_BATCH_SIZE,
      DISPATCH_SYNC_BATCH_SIZE,
      5,
    ])
    expect(result.total).toBe(25)
    expect(result.synced).toHaveLength(25)
    expect(result.failed).toHaveLength(0)
  })

  it('a failed batch counts its ids as failed and does NOT stop later batches', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(summary(ids(10)))
      .mockRejectedValueOnce(new Error('timeout of 120000ms exceeded'))
      .mockResolvedValueOnce(summary(ids(5)))
    const result = await syncDispatchesInBatches(ids(25), call)

    expect(call).toHaveBeenCalledTimes(3)
    expect(result.synced).toHaveLength(15)
    expect(result.failed).toHaveLength(10)
    expect(result.failed.map((f) => f.id)).toEqual(ids(20).slice(10))
    expect(result.failed[0].reason).toBe('Sync request failed')
  })

  it('an empty selection makes no calls', async () => {
    const call = vi.fn(async (batch: string[]) => summary(batch))
    const result = await syncDispatchesInBatches([], call)

    expect(call).not.toHaveBeenCalled()
    expect(result).toEqual({ total: 0, synced: [], unchanged: [], failed: [] })
  })

  it('per-batch server failures are preserved verbatim in the merged summary', async () => {
    const call = vi.fn(async (batch: string[]) =>
      summary([], batch.slice(0, 1), [
        { id: batch[1], reason: 'Courier is not configured' },
      ]),
    )
    const result = await syncDispatchesInBatches(ids(4), call)

    expect(result.unchanged).toHaveLength(1)
    expect(result.failed).toEqual([
      { id: 'd-2', reason: 'Courier is not configured' },
    ])
  })
})
