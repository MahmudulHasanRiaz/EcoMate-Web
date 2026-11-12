import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

/** One PhysicalInventory row as returned by GET /inventory/physical. */
export interface WarehousePhysicalStockRow {
  id: string
  productId: string
  variantId: string | null
  warehouseId: string
  binLocationId: string | null
  quantity: number
  reservedQuantity: number
}

/**
 * Per-item on-hand physical stock for one warehouse — the figures the
 * physical-adjust dialog pre-validates deductions against.
 *
 * Same endpoint, shape and query key as the Physical Stock table
 * (GET /inventory/physical?warehouseId=…; ['physical-stock', warehouseId]),
 * so the table's cached rows are reused and the shared post-adjust
 * invalidation (invalidateInventoryStockQueries) covers this reader too.
 */
export function useWarehousePhysicalStock(warehouseId: string, enabled = true) {
  return useQuery<WarehousePhysicalStockRow[]>({
    queryKey: ['physical-stock', warehouseId],
    queryFn: () =>
      apiClient
        .get('/inventory/physical', { params: { warehouseId } })
        .then((r) => r.data?.data || r.data || []),
    enabled: enabled && !!warehouseId,
  })
}

export interface PhysicalAdjustItemRef {
  productId: string
  variantId?: string
  binLocationId?: string
}

/**
 * On-hand for one dialog item in the warehouse. Null = unknown (no rows
 * loaded yet — figures still loading, query failed, or no warehouse
 * picked): never treated as 0, so pre-validation never blocks on a missing
 * number. A successful query with no matching row means genuinely no stock
 * in that warehouse: 0.
 *
 * Bin-aware, mirroring the server write (stock.service applyPhysicalChange):
 * with a bin picked, the deduction lands on that bin's row alone, so the
 * row's own quantity is the figure; with no bin, the dialog works in
 * warehouse totals (the sum across the item's rows). Stock split across
 * bins can still be refused server-side (the server decrements a single
 * row); the server stays the backstop for that case.
 *
 * The figure is on-hand (quantity), NOT quantity minus reserved — the
 * server's below-zero guard is on quantity alone, same as the managed
 * modal's on-hand check.
 */
export function physicalOnHandForItem(
  rows: WarehousePhysicalStockRow[] | undefined,
  item: PhysicalAdjustItemRef,
): number | null {
  if (!rows) return null
  const binId = item.binLocationId && item.binLocationId !== '__none__' ? item.binLocationId : undefined
  const matching = rows.filter(
    (r) => r.productId === item.productId && (r.variantId ?? undefined) === (item.variantId ?? undefined),
  )
  if (binId) {
    const binRow = matching.find((r) => r.binLocationId === binId)
    return binRow ? binRow.quantity : 0
  }
  return matching.reduce((sum, r) => sum + (r.quantity ?? 0), 0)
}
