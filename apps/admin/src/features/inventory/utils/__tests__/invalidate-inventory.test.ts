import { describe, expect, it, vi } from 'vitest'
import {
  INVENTORY_STOCK_QUERY_KEYS,
  invalidateInventoryStockQueries,
} from '../invalidate-inventory'

describe('invalidateInventoryStockQueries (finding 3)', () => {
  it('invalidates every stock-quantity key, including the drawer/detail per-product keys', () => {
    const invalidateQueries = vi.fn()
    invalidateInventoryStockQueries({ invalidateQueries } as any)

    const calledWith = invalidateQueries.mock.calls.map(
      (call) => (call[0] as { queryKey: readonly string[] }).queryKey,
    )
    expect(calledWith).toEqual(INVENTORY_STOCK_QUERY_KEYS)
    // The keys the pre-fix mutation sites missed — the drawer reads these.
    expect(calledWith).toContainEqual(['inventory-physical'])
    expect(calledWith).toContainEqual(['inventory-ledger'])
    expect(calledWith).toContainEqual(['inventory-reservations'])
    expect(calledWith).toContainEqual(['inventory-physical-detail'])
    expect(calledWith).toContainEqual(['inventory-reservations-detail'])
    expect(calledWith).toContainEqual(['physical-stock'])
  })
})
