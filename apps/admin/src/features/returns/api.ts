import { apiClient } from '@/lib/api-client'

export interface ReturnOrderLink {
  id: string
  displayId: string
}

export interface ReturnListItem {
  id: string
  displayId: string
  orderId: string
  type: 'FULL' | 'PARTIAL' | 'EXCHANGE'
  status: string
  source: string
  items: { productId: string; variantId?: string | null; quantity: number }[]
  reason?: string | null
  courier?: string | null
  courierReturnId?: string | null
  courierStatus?: string | null
  stockReconciled: boolean
  stockReconciledAt?: string | null
  refundId?: string | null
  exchangeOrderId?: string | null
  createdAt: string
  updatedAt: string
  order?: ReturnOrderLink | null
}

export interface ReturnDetail extends ReturnListItem {
  exchangeOrder?: ReturnOrderLink | null
  refund?: { id: string; status?: string } | null
}

export interface ReturnsListResponse {
  data: ReturnListItem[]
  meta: { total: number; page: number; limit: number }
}

export interface ReturnsListQuery {
  orderId?: string
  status?: string
  type?: string
  source?: string
  courier?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  page?: number
  limit?: number
}

/**
 * Unified Return entity client (Task 7 lists/detail).
 * Backend: GET /returns (status/type/source/courier/date/search/page/limit),
 * GET /returns/:id (order + exchangeOrder + refund links),
 * POST /returns/:id/mark-received, POST /couriers/steadfast/reconcile-return.
 */
export const returnsApi = {
  list: (q: ReturnsListQuery = {}) =>
    apiClient.get<ReturnsListResponse>('/returns', { params: q }).then((r) => r.data),
  get: (id: string) => apiClient.get<ReturnDetail>(`/returns/${id}`).then((r) => r.data),
  /** Staff creation (the unified Create-return dialog): FULL or PARTIAL. */
  create: (data: {
    orderId: string
    type: 'FULL' | 'PARTIAL' | 'EXCHANGE'
    source?: 'STAFF' | 'COURIER' | 'EXCHANGE'
    items?: { productId: string; variantId?: string | null; quantity: number }[]
    reason?: string
    /** Signed per-field adjustment on the ORIGINAL order (partial returns only). */
    shippingAdjustment?: number
    /** Signed per-field adjustment on the ORIGINAL order (partial returns only). */
    discountAdjustment?: number
    /**
     * Partial returns only (default true): true → the ORIGINAL order is set to
     * Delivered on creation; false → status left to courier updates. Explicit
     * on FULL is a 400.
     */
    markOriginalDelivered?: boolean
  }) => apiClient.post<ReturnListItem>('/returns', data).then((r) => r.data),
  markReceived: (id: string, items?: { productId: string; variantId?: string | null; quantity: number }[]) =>
    apiClient.post<ReturnDetail>(`/returns/${id}/mark-received`, items ? { items } : {}).then((r) => r.data),
  /** Staff-triggered return reconciliation (original consignment id). */
  checkReturnStatus: (consignmentId: string) =>
    apiClient
      .post('/couriers/steadfast/reconcile-return', { consignmentId })
      .then((r) => r.data),
}
