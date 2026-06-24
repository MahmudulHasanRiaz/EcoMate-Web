import { apiClient } from '@/lib/api-client'

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
  createdAt: string
  updatedAt: string
  _count?: { purchases: number }
}

export const suppliersApi = {
  list: (activeOnly?: boolean) => apiClient.get<SupplierResponse[]>('/suppliers', { params: { activeOnly } }),
  get: (id: string) => apiClient.get<SupplierResponse>(`/suppliers/${id}`),
  create: (data: any) => apiClient.post<SupplierResponse>('/suppliers', data),
  update: (id: string, data: any) => apiClient.put<SupplierResponse>(`/suppliers/${id}`, data),
  delete: (id: string) => apiClient.delete(`/suppliers/${id}`),
}
