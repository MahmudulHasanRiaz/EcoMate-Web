import { apiClient } from '@/lib/api-client'

export interface SupplierPaymentResponse {
  id: string
  supplierId: string
  amount: number
  paidAt: string
  paymentMethod?: string | null
  reference?: string | null
  notes?: string | null
  invoices?: { id: string; invoiceNo: string }[]
  createdAt: string
}

export interface SupplierResponse {
  id: string
  name: string
  slug: string
  contactPerson?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  taxId?: string | null
  paymentTerms?: string | null
  notes?: string | null
  isActive: boolean
  totalPurchases: number
  totalPaid: number
  balance: number
  _count?: { purchases: number }
  payments?: SupplierPaymentResponse[]
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

export const suppliersApi = {
  list: (activeOnly?: boolean) => apiClient.get<SupplierResponse[]>('/suppliers', { params: { activeOnly } }),
  get: (id: string) => apiClient.get<SupplierResponse>(`/suppliers/${id}`),
  create: (data: any) => apiClient.post<SupplierResponse>('/suppliers', data),
  update: (id: string, data: any) => apiClient.put<SupplierResponse>(`/suppliers/${id}`, data),
  delete: (id: string) => apiClient.delete(`/suppliers/${id}`),
  createPayment: (id: string, data: any) => apiClient.post<SupplierPaymentResponse>(`/suppliers/${id}/payments`, data),
  getPayments: (id: string, params?: any) => apiClient.get<{ data: SupplierPaymentResponse[]; meta: any }>(`/suppliers/${id}/payments`, { params }),
  getPayment: (paymentId: string) => apiClient.get<SupplierPaymentResponse>(`/suppliers/payments/${paymentId}`),
}
