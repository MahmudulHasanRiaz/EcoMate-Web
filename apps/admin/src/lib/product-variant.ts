import { resolveOrderItemImages } from './product-image'

/**
 * Shared helpers for rendering product variants in order/lead pickers.
 * A variant's human label is derived from its attribute values (e.g. "Size: M,
 * Color: Red") rather than a generic "Default Variant"; its thumbnail uses the
 * canonical image hierarchy (variant → color sibling → parent product), not a
 * local copy of that rule.
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
  const resolved = resolveOrderItemImages(parent, v)
  return resolved.image
}