import type { QueryClient } from '@tanstack/react-query'

/**
 * Every TanStack Query key that can serve stock quantities.
 *
 * Finding 3 (2026-11-12 staging verification): a physical adjust left the
 * drawer's Locations / Lots table stale at 12 while the header/list showed
 * 14. Each mutation site invalidated only the list keys it knew about
 * (['inventory-physical-list'], ['inventory-stock-overview'], ...) while the
 * per-product readers use DIFFERENT keys — the drawer reads
 * ['inventory-physical', id] / ['inventory-ledger', id, type] /
 * ['inventory-reservations', id], the full detail page reads the
 * *-detail variants, and the Physical Stock table reads
 * ['physical-stock', warehouse]. With the app-wide staleTime of 30s
 * (main.tsx), reopening the drawer served the still-fresh cached 12 and no
 * refetch happened.
 *
 * Every stock mutation must invalidate through this helper instead of
 * hand-listing keys, so a new reader key added here is fixed for all
 * mutation sites at once. Prefix matching applies: e.g. ['inventory-ledger']
 * also covers the movement ledger's
 * ['inventory-ledger', productId, variantId, page, typeFilter].
 */
export const INVENTORY_STOCK_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  ['inventory-physical'],
  ['inventory-physical-list'],
  ['inventory-physical-detail'],
  ['inventory-stock-overview'],
  ['inventory-stock-detail'],
  ['inventory-ledger'],
  ['inventory-reservations'],
  ['inventory-reservations-detail'],
  ['inventory-history-logs'],
  ['physical-reservations'],
  ['physical-stock'],
]

export function invalidateInventoryStockQueries(queryClient: QueryClient): void {
  for (const queryKey of INVENTORY_STOCK_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
