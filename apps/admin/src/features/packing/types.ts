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
}

export interface QueueItemProduct {
  id: string
  productName: string
  variantName: string
  sku?: string
  quantity: number
  image: string | null
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
