import { apiClient } from '@/lib/api-client'

export interface OrderResponse {
  id: string; displayId: string; customerId?: string | null; statusId: string;
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
  partialAmount?: number | string | null;
  dispatchLogs?: {
    id: string; courier: string; status: string; message?: string | null;
    consignmentId?: string | null; trackingCode?: string | null;
    createdAt: string;
  }[];
  createdAt: string; updatedAt: string;
  customer: { id: string; firstName: string; lastName: string; email: string; phoneNumber: string } | null;
  status: { id: string; name: string; color: string; nextStatuses: string[] };
  items: { id: string; productId: string; variantId?: string | null; quantity: number; price: number | string; product: { id: string; name: string; images: any; slug?: string } }[];
  payments: { id: string; method: string; amount: number | string; status: string; transactionId?: string | null }[];
  shipment?: { id: string; trackingNo?: string | null; courier?: string | null; status: string } | null;
}

export interface PaginatedResponse<T> { data: T[]; meta: { total: number; page: number; perPage: number; totalPages: number } }

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
}

export { appUrl as mediaUrl } from '@/lib/utils'
