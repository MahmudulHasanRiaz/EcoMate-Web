export interface PhysicalVariantRow {
  id: string
  variantId?: string | null
  variant?: { id?: string; sku?: string | null; image?: string | null; attributeValues?: any[] } | null
  sku?: string | null
  quantity?: number | null
  reservedQuantity?: number | null
  warehouse?: { id?: string; name?: string | null } | null
  binLocation?: { code?: string | null } | null
  updatedAt?: string | null
  _virtual?: boolean
  [key: string]: unknown
}

/**
 * One row per variant. PhysicalInventory rows arrive per
 * (variant × warehouse × bin), which rendered as visually duplicated variant
 * lines. Aggregates quantity/reservedQuantity across locations, unions
 * warehouse/bin names, keeps the most recent updatedAt, and sorts
 * deterministically by SKU — never by updatedAt, so rows do not reshuffle on
 * every refetch.
 */
export function dedupePhysicalVariants(variants: PhysicalVariantRow[]): PhysicalVariantRow[] {
  const map = new Map<string, any>()

  for (const v of variants) {
    const key = String(v.variantId || v.variant?.id || v.id)
    const existing = map.get(key)
    if (!existing) {
      const warehouses = new Set<string>()
      const bins = new Set<string>()
      if (v.warehouse?.name) warehouses.add(v.warehouse.name)
      if (v.binLocation?.code) bins.add(v.binLocation.code)
      map.set(key, {
        ...v,
        quantity: v.quantity || 0,
        reservedQuantity: v.reservedQuantity || 0,
        _warehouses: warehouses,
        _bins: bins,
      })
      continue
    }
    existing.quantity += v.quantity || 0
    existing.reservedQuantity += v.reservedQuantity || 0
    if (v.warehouse?.name) existing._warehouses.add(v.warehouse.name)
    if (v.binLocation?.code) existing._bins.add(v.binLocation.code)
    if (v.updatedAt && (!existing.updatedAt || v.updatedAt > existing.updatedAt)) {
      existing.updatedAt = v.updatedAt
    }
    if (!existing.variant && v.variant) existing.variant = v.variant
  }

  return Array.from(map.values())
    .map(({ _warehouses, _bins, ...rest }) => ({
      ...rest,
      warehouse: _warehouses.size ? { name: Array.from(_warehouses).join(' · ') } : null,
      binLocation: _bins.size ? { code: Array.from(_bins).join(' · ') } : null,
    }))
    .sort((a, b) => {
      const sa = String(a.variant?.sku || a.sku || '')
      const sb = String(b.variant?.sku || b.sku || '')
      return sa.localeCompare(sb)
    })
}
