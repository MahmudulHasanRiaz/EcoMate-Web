import { apiClient } from '@/lib/api-client'

export interface BrandResponse {
  id: string
  name: string
  slug: string
  logo?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  _count?: { products: number }
}

export const brandsApi = {
  list: (activeOnly?: boolean) => apiClient.get<BrandResponse[]>('/brands', { params: { activeOnly } }),
  get: (id: string) => apiClient.get<BrandResponse>(`/brands/${id}`),
  create: (data: any) => apiClient.post<BrandResponse>('/brands', data),
  update: (id: string, data: any) => apiClient.put<BrandResponse>(`/brands/${id}`, data),
  delete: (id: string) => apiClient.delete(`/brands/${id}`),
}
