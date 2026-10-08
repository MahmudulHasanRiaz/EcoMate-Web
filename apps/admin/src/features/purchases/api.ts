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
  shortClosedQty?: number
  shortCloseReason?: string | null
  product?: { id: string; name: string; images: any; sku?: string | null }
  variant?: { id: string; sku?: string | null; attributeValues?: { attributeValue: { value: string } }[] }
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
  summary?: PurchaseSummary
  events?: PurchaseEvent[]
  createdAt: string
  updatedAt: string
}

export interface GrnItemResponse {
  id: string
  productId: string
  variantId?: string | null
  receivedQty: number
  acceptedQty: number
  rejectedQty: number
  unitCost: number
  totalCost: number
  damageResponsibility?: string
  freeOfCharge?: boolean
  lineWarehouseId?: string | null
  purchaseItem?: { product?: { id: string; name: string; images: any } }
}

export interface PurchaseDispositionItem {
  purchaseItemId: string
  ordered: number
  received: number
  accepted: number
  rejected: number
  shortClosed: number
  shortCloseReason: string | null
  remaining: number
  done: boolean
  unitBase: number
  lines: any[]
}

export interface PurchaseSummary {
  items: PurchaseDispositionItem[]
  totals: {
    orderedValue: number
    acceptedValue: number
    shortClosedValue: number
    supplierDamageValue: number
    companyDamageValue?: number
    remainingQty: number
  }
}

export interface PurchaseEvent {
  id: string
  type: string
  message: string
  data?: any
  performedBy?: string | null
  createdAt: string
}
export interface GrnResponse {
  id: string
  grnNumber: string
  purchaseId: string
  warehouseId?: string
  warehouse?: { id: string; name: string }
  receivedBy?: string | null
  receivedAt?: string
  notes?: string | null
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
  createGrn: (id: string, data: {
    warehouseId: string
    items: {
      purchaseItemId: string
      productId?: string
      variantId?: string | null
      receivedQty: number
      acceptedQty: number
      rejectedQty: number
      damageResponsibility?: 'supplier' | 'company'
      freeOfCharge?: boolean
      lineWarehouseId?: string
    }[]
    notes?: string
  }, idempotencyKey?: string) => apiClient.post<GrnResponse>(
    `/purchases/${id}/grn`,
    data,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
  ),
  shortClose: (id: string, data: { items: { purchaseItemId: string; qty: number; reason: string }[] }) =>
    apiClient.post<PurchaseResponse>(`/purchases/${id}/short-close`, data),
  cancel: (id: string, data: { reason: string }) =>
    apiClient.post<PurchaseResponse>(`/purchases/${id}/cancel`, data),
  getGrns: (id: string) => apiClient.get<GrnResponse[]>(`/purchases/${id}/grns`),
  getGrn: (grnId: string) => apiClient.get<GrnResponse>(`/purchases/grn/${grnId}`),
}
