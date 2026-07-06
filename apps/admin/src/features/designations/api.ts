import { apiClient } from '@/lib/api-client'

export interface DesignationResponse {
  id: string
  name: string
  slug: string
  level: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export const designationsApi = {
  list: () => apiClient.get<DesignationResponse[]>('/designations'),
  create: (data: { name: string; level?: number }) =>
    apiClient.post<DesignationResponse>('/designations', data),
  update: (id: string, data: Partial<{ name: string; level: number; isActive: boolean }>) =>
    apiClient.put<DesignationResponse>(`/designations/${id}`, data),
  delete: (id: string) => apiClient.delete(`/designations/${id}`),
}
