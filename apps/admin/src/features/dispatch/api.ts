import { apiClient } from '@/lib/api-client'

export interface DispatchResponse {
  id: string
  // NULL = UNMATCHED: the courier reported this consignment but no order
  // could be resolved for it yet — staff assign it from the Dispatch list.
  orderId: string | null
  courier: string
  // The merchant order id / invoice the courier carries, verbatim.
  courierInvoiceRef: string | null
  // NULL until the courier booking exists — the webhook backfills it.
  consignmentId: string | null
  trackingCode: string | null
  trackingUrl: string | null
  status: string
  courierStatus: string | null
  courierStatusAt: string | null
  lastSyncedAt: string | null
  handedOverAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  productMapping: any
  notes: string | null
  // API = EcoMate called the courier cancel endpoint; MANUAL = the booking has
  // to be cancelled by hand in the courier panel (e.g. Steadfast has no API).
  courierCancelMode?: 'API' | 'MANUAL' | null
  courierCancelRef?: string | null
  courierCancelAt?: string | null
  // Set when the cancelled booking still waits for a human in the courier panel.
  panelCancelPending?: boolean
  panelCancelConfirmedAt?: string | null
  panelCancelConfirmedBy?: string | null
  createdAt: string
  updatedAt: string
  order?: { displayId: string; total: number; guestName?: string; guestPhone?: string; courierStatus?: string | null } | null
}

export interface DispatchSyncItem {
  id: string
  dispatchId?: string
  status?: string
  message?: string
  reason?: string
}

export interface DispatchSyncSummary {
  total: number
  synced: DispatchSyncItem[]
  unchanged: DispatchSyncItem[]
  failed: DispatchSyncItem[]
}

/**
 * GET /dispatch/metrics returns ONE object with pre-aggregated groups, not an
 * array of raw `groupBy` rows. Typing it as an array made every metrics card
 * render blank because `data.reduce` threw.
 */
export interface DispatchMetricsResponse {
  total: number
  byCourier: { courier: string; count: number }[]
  byStatus: { status: string; count: number }[]
}

export interface DispatchFacets {
  status: Record<string, number>
  courier: Record<string, number>
}

export const dispatchApi = {
  list: (params?: any) =>
    apiClient.get<{
      data: DispatchResponse[]
      total: number
      facets?: DispatchFacets
    }>('/dispatch', { params }),
  get: (id: string) => apiClient.get<DispatchResponse>(`/dispatch/${id}`),
  create: (data: any) => apiClient.post<DispatchResponse>('/dispatch', data),
  updateStatus: (id: string, status: string) =>
    apiClient.patch(`/dispatch/${id}/status`, { status }),
  syncStatus: (ids: string[]) =>
    apiClient.post<DispatchSyncSummary>('/dispatch/sync-status', { ids }, {
      // The backend syncs sequentially, one live courier call per dispatch
      // (up to ~10s each). A batch of 10 can legitimately take far longer
      // than the client's default 15s timeout — that mismatch is what made
      // bulk syncs of 50-60 dispatches "fail" wholesale (the request died
      // client-side while the server was still working). 120s per batch.
      timeout: 120_000,
    }),
  remove: (id: string) => apiClient.delete(`/dispatch/${id}`),
  // Staff confirm the MANUAL courier-panel cancellation; the server records
  // the actor + timestamp and clears the "Panel cancellation pending" marker.
  confirmPanelCancel: (id: string) =>
    apiClient.post(`/dispatch/${id}/confirm-panel-cancel`, {}),
  // Assign an UNMATCHED dispatch to an order (auto-connect, 2026-11-01).
  assign: (id: string, orderId: string) =>
    apiClient.post<DispatchResponse>(`/dispatch/${id}/assign`, { orderId }),
  // Filter-aware overview: pass the same params as the list so the figures
  // describe the filtered set, not the global totals.
  getMetrics: (params?: any) =>
    apiClient.get<DispatchMetricsResponse>('/dispatch/metrics', { params }),
}
