import { apiClient } from '@/lib/api-client'

export interface PurchaseItem {
  id: string
  productId: string
  quantity: number
  unitPrice: number
}

export interface PurchaseResponse {
  id: string
  referenceNo: string
  supplierId: string
  supplier?: { id: string; name: string }
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'
  total: number
  orderDate: string
  notes?: string | null
  items: PurchaseItem[]
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export const purchasesApi = {
  list: (params?: any) => apiClient.get<PaginatedResponse<PurchaseResponse>>('/purchases', { params }),
  get: (id: string) => apiClient.get<PurchaseResponse>(`/purchases/${id}`),
  create: (data: any) => apiClient.post<PurchaseResponse>('/purchases', data),
  update: (id: string, data: any) => apiClient.put<PurchaseResponse>(`/purchases/${id}`, data),
  delete: (id: string) => apiClient.delete(`/purchases/${id}`),
  receiveItems: (id: string, items: { itemId: string; receivedQty: number }[]) => apiClient.post(`/purchases/${id}/receive`, { items }),
  updateStatus: (id: string, status: string) => apiClient.put(`/purchases/${id}/status`, { status }),
}
