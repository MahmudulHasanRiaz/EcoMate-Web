import { apiClient } from '@/lib/api-client'

export interface OrderResponse {
  id: string; displayId: string; customerId?: string | null; statusId: string;
  warnings?: string[];
  kind?: 'SALE' | 'RETURN';
  returnOfOrderId?: string | null;
  returnOfOrder?: { id: string; displayId: string; status: { id: string; name: string } } | null;
  returnedAt?: string | null;
  stockRestored?: boolean;
  subtotal: number | string; shippingCharge: number | string; discount: number | string;
  discountType: string; total: number | string;
  shippingAddress: any; customerNotes?: string | null; officeNotes?: string | null; timeline: any[];
  courierService?: string | null; courierStatus?: string | null;
  courierTrackingCode?: string | null; courierConsignmentId?: string | null;
  trackingUrl?: string | null;
  assignedToId?: string | null; assignedAt?: string | null;
  assignee?: { id: string; firstName: string; lastName: string } | null;
  guestName?: string | null;
  guestPhone?: string | null;
  viewToken?: string | null;
  paymentMethod?: string | null;
  paymentMode?: string | null;
  paymentOptionType?: 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY' | null;
  paymentStatus?: 'PAYMENT_PENDING' | 'PENDING' | 'PAID' | 'PARTIAL_PAID' | 'UNPAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | null;
  partialAmount?: number | string | null;
  dispatchLogs?: {
    id: string; courier: string; status: string; message?: string | null;
    consignmentId?: string | null; trackingCode?: string | null;
    createdAt: string;
  }[];
  dispatches?: {
    id: string;
    courier: string;
    consignmentId: string;
    trackingCode: string | null;
    trackingUrl?: string | null;
    status: string;
    productMapping: any;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  selectedShippingOptionId?: string | null;
  shippingChargeOverridden?: boolean;
  /** Actual fulfillment/courier cost (BDT). null = not recorded. */
  shippingCost?: number | string | null;
  /** 'manual' (actual) | 'courier_default' (estimated). */
  shippingCostSource?: string | null;
  salesChannel?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  sourceEntity?: string | null;
  trashedAt?: string | null;
  createdAt: string; updatedAt: string;
  customer: { id: string; firstName: string; lastName: string; email: string; phoneNumber: string } | null;
  status: { id: string; name: string; color: string; nextStatuses: string[] };
  items: { id: string; productId: string; variantId?: string | null; quantity: number; price: number | string; product: { id: string; name: string; images: any; slug?: string } }[];
  payments: { id: string; method?: string; gatewayCode?: string; amount: number | string; status: string; transactionId?: string | null }[];
  shipment?: { id: string; trackingNo?: string | null; courier?: string | null; status: string } | null;
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
    statusCounts?: Record<string, number>
  }
}

export interface RtnOrderPreview {
  id: string
  displayId: string
  status: string
  itemCount: number
}

export interface RtnOrderResponse {
  id: string
  displayId: string
  status: { id: string; name: string; color: string }
  returnOfOrderId: string | null
  returnOfOrder: { id: string; displayId: string; status: { id: string; name: string } } | null
  items: { id: string; productId: string; variantId?: string | null; comboId?: string | null; quantity: number; price: number | string; product: { id: string; name: string; sku?: string } | null; variant?: { id: string; sku?: string } | null; combo?: { id: string; name: string } | null }[]
  returnedAt: string | null
  stockRestored: boolean
  createdAt: string
  updatedAt: string
}

export interface ScanPurposeDescriptor {
  purpose: 'DISPATCH_HANDED_OVER' | 'DISPATCH_RETURN' | 'ORDER_STATUS' | 'STICKER_PRINT'
  label: string
  description: string
}

export interface ScanDispatchPreview {
  id: string
  courier: string
  consignmentId: string
  trackingCode: string | null
  status: string
  orderId: string
  orderDisplayId: string
  orderStatus: string
  orderKind: string
}

export interface ScanOrderPreview {
  id: string
  displayId: string
  status: string
  kind: string
  allowedStatuses: { id: string; name: string }[]
}

export interface ScanResolveOutcome {
  status: 'resolved' | 'selection_required' | 'not_found'
  identifier: string
  message?: string
  dispatches: ScanDispatchPreview[]
  order: ScanOrderPreview | null
}

export interface ScanResult {
  status: 'success' | 'warning' | 'error' | 'duplicate'
  identifier: string
  title: string
  message: string
  courier?: string
  oldState?: string
  newState?: string
  details?: Record<string, any>
}

export const ordersApi = {
  list: (query?: any) => apiClient.get<PaginatedResponse<OrderResponse>>('/orders', { params: query }),
  get: (id: string) => apiClient.get<OrderResponse>(`/orders/${id}`),
  create: (data: any) => apiClient.post<OrderResponse>('/orders', data),
  updateOrder: (id: string, data: any) => apiClient.put<OrderResponse>(`/orders/${id}`, data),
  updateStatus: (id: string, statusId: string, note?: string) => apiClient.put(`/orders/${id}/status`, { statusId, note }),
  addNote: (orderId: string, note: string, visibility: 'public' | 'private') => apiClient.post(`/orders/${orderId}/note`, { note, visibility }),
  addItem: (orderId: string, data: { productId: string; quantity: number; price: number; variantId?: string }) => apiClient.post(`/orders/${orderId}/items`, data),
  removeItem: (orderId: string, itemId: string) => apiClient.delete(`/orders/${orderId}/items/${itemId}`),
  bulkAssign: (ids: string[], assignedToId: string | null) => apiClient.post('/orders/bulk/assign', { ids, assignedToId }),
  rotateViewToken: (orderId: string) => apiClient.post<{ id: string; viewToken: string; displayId: string }>(`/orders/${orderId}/rotate-view-token`),
  backfillViewTokens: () => apiClient.post<{ updated: number; total: number }>('/orders/backfill-view-tokens'),
  trash: (id: string) => apiClient.post(`/orders/${id}/trash`),
  restore: (id: string) => apiClient.post(`/orders/${id}/restore`),
}

export const rtnApi = {
  forOrder: (orderId: string) => apiClient.get<RtnOrderPreview | null>(`/rtn/order/${orderId}`).then(r => r.data),
  get: (id: string) => apiClient.get<RtnOrderResponse>(`/rtn/${id}`).then(r => r.data),
  create: (orderId: string, items: { orderItemId: string; quantity: number }[]) =>
    apiClient.post<RtnOrderResponse>(`/rtn/from-order/${orderId}`, { items }).then(r => r.data),
  finalizeDispatch: (dispatchId: string) =>
    apiClient.post(`/rtn/dispatch/${dispatchId}/finalize-return`).then(r => r.data),
}

export const scannerApi = {
  purposes: () => apiClient.get<ScanPurposeDescriptor[]>('/scanner/purposes').then(r => r.data),
  resolve: (identifier: string, purpose?: string) =>
    apiClient.post<ScanResolveOutcome>('/scanner/resolve', { identifier, purpose }).then(r => r.data),
  scan: (payload: {
    purpose: string
    identifier: string
    dispatchId?: string
    orderId?: string
    targetStatusId?: string
  }) => apiClient.post<ScanResult>('/scanner/scan', payload).then(r => r.data),
}

export { appUrl as mediaUrl } from '@/lib/utils'
