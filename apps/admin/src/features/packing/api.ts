import { apiClient } from '@/lib/api-client'
import type { QueueItem, PackingStats, HoldFormData, HistoryEntry, ActiveLock, ProductPhotoCatalogEntry } from './types'

/** Raw photo data per product, keyed by product id. Shared across the page. */
export type PhotoCatalog = Record<string, ProductPhotoCatalogEntry>

/**
 * `GET /packing/queue` response. The catalog is shared by every order in the
 * page and returned once at the top level (it used to be attached to each
 * order, serializing the whole catalog once per order).
 *
 * `total` is the number of orders matching the query (NOT the page length), so
 * the workspace can tell the packer when more orders exist than were loaded.
 */
export interface PackingQueueResponse {
  orders: QueueItem[]
  photoCatalog: PhotoCatalog
  total: number
}

export const packingApi = {
  getQueue: (search?: string) =>
    apiClient
      .get<PackingQueueResponse>('/packing/queue', { params: search ? { search } : {} })
      .then((r) => r.data),

  openOrder: (id: string) =>
    apiClient.get(`/packing/queue/${id}`).then((r) => r.data),

  /** Full detail for a single order, in the queue envelope shape. */
  getOrderDetail: (id: string) =>
    apiClient
      .get<PackingQueueResponse | null>(`/packing/queue/${id}/detail`)
      .then((r) => r.data),

  markDone: (id: string, verificationMode: string) =>
    apiClient.post(`/packing/queue/${id}/done`, { verificationMode }).then((r) => r.data),

  markHold: (id: string, data: HoldFormData) =>
    apiClient.post(`/packing/queue/${id}/hold`, data).then((r) => r.data),

  releaseLock: (id: string) =>
    apiClient.delete(`/packing/queue/${id}/lock`).then((r) => r.data),

  checkOrderStatus: (code: string) =>
    apiClient
      .get<{
        exists: boolean
        id?: string
        displayId?: string
        status?: string
      }>(`/packing/check/${code}`)
      .then((r) => r.data),

  getStats: (all?: boolean) =>
    apiClient.get<PackingStats>('/packing/stats', { params: all ? { all: 'true' } : {} }).then((r) => r.data),

  getLocks: () =>
    apiClient.get<ActiveLock[]>('/packing/locks').then((r) => r.data),

  getHistory: (packerId?: string) =>
    apiClient.get<HistoryEntry[]>('/packing/history', { params: packerId ? { packerId } : {} }).then((r) => r.data),
}
