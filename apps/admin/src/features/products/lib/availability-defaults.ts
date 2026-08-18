/**
 * Availability-mode default resolution for the product form.
 *
 * Global Inventory Management ON  → new SIMPLE product defaults to
 *                                   INVENTORY_CONTROLLED.
 * Global Inventory Management OFF → new SIMPLE product defaults to
 *                                   MANAGED_STOCK.
 * Variable products always default to MANAGED_STOCK (the backend's
 * authoritative rule — variable products can't be INVENTORY_CONTROLLED).
 * Once the user touches the mode select, or when editing/restoring an
 * existing record, the stored/explicit mode always wins.
 */
export function defaultAvailabilityMode(input: {
  imEnabled: boolean | undefined
  type: string
  userTouched: boolean
  hasExistingRow: boolean
  hasDraft: boolean
}): 'INVENTORY_CONTROLLED' | 'MANAGED_STOCK' | undefined {
  const { imEnabled, type, userTouched, hasExistingRow, hasDraft } = input
  if (imEnabled === undefined) return undefined
  if (userTouched || hasExistingRow || hasDraft) return undefined
  if (type !== 'simple') return 'MANAGED_STOCK'
  return imEnabled ? 'INVENTORY_CONTROLLED' : 'MANAGED_STOCK'
}
