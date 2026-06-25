import { apiClient } from '@/lib/api-client'

export interface PurchaseItem {
  id: string
  productId: string
  variantId?: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  totalBill: number
  receivedQty: number
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
  grns?: GrnResponse[]
  costingLots?: any[]
  createdAt: string
  updatedAt: string
}

export interface GrnItemResponse {
  id: string
  productId: string
  receivedQty: number
  acceptedQty: number
  rejectedQty: number
  unitCost: number
  totalCost: number
}

export interface GrnResponse {
  id: string
  grnNumber: string
  purchaseId: string
  status: string
  items: GrnItemResponse[]
  createdAt: string
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
  createGrn: (id: string, data: { items: { purchaseItemId: string; productId: string; receivedQty: number; acceptedQty: number; rejectedQty: number }[]; notes?: string }) =>
    apiClient.post<GrnResponse>(`/purchases/${id}/grn`, data),
  getGrns: (id: string) => apiClient.get<GrnResponse[]>(`/purchases/${id}/grns`),
  getGrn: (grnId: string) => apiClient.get<GrnResponse>(`/purchases/grn/${grnId}`),
}
