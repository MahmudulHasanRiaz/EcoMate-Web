import { apiClient } from '@/lib/api-client'

export interface AccessPresetResponse {
  id: string
  name: string
  description: string | null
  permissions: string[]
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const accessPresetsApi = {
  list: (page = 1, perPage = 20, search?: string) =>
    apiClient.get<PaginatedResponse<AccessPresetResponse>>('/access-presets', {
      params: { page, perPage, search },
    }),
  get: (id: string) =>
    apiClient.get<AccessPresetResponse>(`/access-presets/${id}`),
  create: (data: { name: string; description?: string; permissions: string[] }) =>
    apiClient.post<AccessPresetResponse>('/access-presets', data),
  update: (id: string, data: Partial<{ name: string; description?: string; permissions: string[] }>) =>
    apiClient.put<AccessPresetResponse>(`/access-presets/${id}`, data),
  delete: (id: string) =>
    apiClient.delete(`/access-presets/${id}`),
}
