import { apiClient } from '@/lib/api-client'

export interface ReturnOrderLink {
  id: string
  displayId: string
}

/** Variant attribute chain on the order snapshot (variantLabel source). */
export interface ReturnOrderVariantAttribute {
  attributeValue: {
    value?: string | null
    hexCode?: string | null
    attribute?: { name?: string | null } | null
  }
}

/** Product/variant snapshot per ORDER LINE (GET /returns/:id deep include). */
export interface ReturnOrderItem {
  productId: string
  variantId?: string | null
  quantity: number
  price?: number | string | null
  product?: { id: string; name: string; sku?: string | null; images?: string[] | null } | null
  variant?: {
    id: string
    sku?: string | null
    image?: string | null
    images?: string[] | null
    attributeValues?: ReturnOrderVariantAttribute[]
  } | null
}

/** Original ORDER embedded by GET /returns/:id (customer snapshot + line items). */
export interface ReturnOrderSnapshot extends ReturnOrderLink {
  kind?: string | null
  createdAt?: string | null
  customerFirstName?: string | null
  customerLastName?: string | null
  guestName?: string | null
  customerPhone?: string | null
  guestPhone?: string | null
  secondaryPhone?: string | null
  customer?: { id: string; name?: string | null; email?: string | null; phone?: string | null } | null
  items?: ReturnOrderItem[] | null
}

export interface ReturnDamageLogEntry {
  qty: number
  at: string
  by?: string | null
  phase: 'receive' | 'later'
}

export interface ReturnLineItem {
  productId: string
  variantId?: string | null
  quantity: number
  /** Units of quantity that must never be restocked. Absent = 0. */
  damagedQuantity?: number
  damageLog?: ReturnDamageLogEntry[]
  warehouseId?: string | null
}

export interface ReturnListItem {
  id: string
  displayId: string
  orderId: string
  type: 'FULL' | 'PARTIAL' | 'EXCHANGE'
  status: string
  source: string
  items: ReturnLineItem[]
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
  /** staff email / free-text performer (Task 1 column). */
  createdBy?: string | null
  order?: ReturnOrderSnapshot | null
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
    items?: ReturnLineItem[]
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
  markReceived: (id: string, items?: ReturnLineItem[]) =>
    apiClient.post<ReturnDetail>(`/returns/${id}/mark-received`, items ? { items } : {}).then((r) => r.data),
  /** Damaged AFTER receive — stock write-off in one transaction. */
  markDamaged: (id: string, items: { productId: string; variantId?: string | null; quantity: number }[]) =>
    apiClient.post<ReturnDetail>(`/returns/${id}/mark-damaged`, { items }).then((r) => r.data),
  /** Staff-triggered return reconciliation (original consignment id). */
  checkReturnStatus: (consignmentId: string) =>
    apiClient
      .post('/couriers/steadfast/reconcile-return', { consignmentId })
      .then((r) => r.data),
}
