export interface ProductPhotoCatalogEntry {
  images: unknown
  variants: {
    id: string | null
    image: string | null
    images: unknown
    attributeValues: {
      attributeValue: {
        value: string | null
        hexCode: string | null
        attribute: { name: string | null }
      } | null
    }[]
  }[]
}

export interface QueueItem {
  id: string
  displayId: string
  customer: { id?: string; name: string; phone?: string } | null
  items: QueueItemProduct[]
  totalItems: number
  packingLock: PackingLockInfo | null
  statusName: string
  statusColor: string
  createdAt: string
  /**
   * Raw photo data per product, used by the canonical image resolver
   * (lib/product-image.ts) to apply the variant → color-sibling → product
   * hierarchy. Keyed by product id. Absent on legacy payloads.
   */
  photoCatalog?: Record<string, ProductPhotoCatalogEntry> | null
}

export interface QueueItemProduct {
  id: string
  productId?: string | null
  variantId?: string | null
  productName: string
  variantName: string
  sku?: string
  quantity: number
  image: string | null
  /** Parent product image, used when the variant image is missing/broken. */
  fallbackImage: string | null
}

export interface PackingLockInfo {
  packerId: string
  packerName: string
  startedAt: string
  expiresAt: string | null
}

export interface PackingStats {
  packed: number
  held: number
  pending: number
}

export interface HoldFormData {
  reason: string
  notes?: string
}

export interface HistoryEntry {
  id: string
  displayId: string
  status: string
  statusColor: string
  packerName: string
  updatedAt: string
}

export interface ActiveLock {
  id: string
  orderId: string
  displayId: string
  packerName: string
  startedAt: string
  expiresAt: string | null
  isExpired: boolean
}
