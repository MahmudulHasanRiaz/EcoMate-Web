/**
 * Shared helpers for rendering product variants in order/lead pickers.
 * A variant's human label is derived from its attribute values (e.g. "Size: M,
 * Color: Red") rather than a generic "Default Variant"; its thumbnail prefers
 * the variant's own image but falls back to the parent product image.
 */
export function variantLabel(v: any): string {
  if (!v) return 'Variant'
  if (v.name) return v.name
  const parts = (v.attributeValues || [])
    .map((av: any) => {
      const attr = av?.attributeValue?.attribute?.name
      const value = av?.attributeValue?.value
      if (attr && value) return `${attr}: ${value}`
      return value || ''
    })
    .filter(Boolean)
  if (parts.length) return parts.join(', ')
  return v.sku || 'Variant'
}

export function variantThumbUrl(v: any, parent?: any): string | null {
  if (!v) return null
  const candidates = [
    v.images?.[0],
    v.image,
    parent?.images?.[0],
    parent?.image,
  ]
  return candidates.find((c) => typeof c === 'string' && c.length > 0) || null
}