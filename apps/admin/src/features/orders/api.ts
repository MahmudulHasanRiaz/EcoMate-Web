import { apiClient } from '@/lib/api-client'

export interface OrderResponse {
  id: string; displayId: string; customerId: string; statusId: string;
  subtotal: number; shippingCharge: number; discount: number; total: number;
  shippingAddress: any; notes?: string | null; timeline: any[];
  createdAt: string; updatedAt: string;
  customer: { id: string; firstName: string; lastName: string; email: string; phoneNumber: string };
  status: { id: string; name: string; color: string; nextStatuses: string[] };
  items: { id: string; productId: string; quantity: number; price: number; product: { id: string; name: string } }[];
  payments: { id: string; method: string; amount: number; status: string; transactionId?: string | null }[];
  shipment?: { id: string; trackingNo?: string | null; courier?: string | null; status: string } | null;
}

export interface PaginatedResponse<T> { data: T[]; meta: { total: number; page: number; perPage: number; totalPages: number } }

export const ordersApi = {
  list: (query?: any) => apiClient.get<PaginatedResponse<OrderResponse>>('/orders', { params: query }),
  get: (id: string) => apiClient.get<OrderResponse>(`/orders/${id}`),
  create: (data: any) => apiClient.post<OrderResponse>('/orders', data),
  updateStatus: (id: string, statusId: string, notes?: string) => apiClient.put(`/orders/${id}/status`, { statusId, notes }),
}
