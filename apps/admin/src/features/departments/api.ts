import { apiClient } from '@/lib/api-client'

export interface DepartmentResponse {
  id: string
  name: string
  slug: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface DepartmentsQuery {
  page?: number
  perPage?: number
  isActive?: boolean
}

export const departmentsApi = {
  list: (query?: DepartmentsQuery) =>
    apiClient.get<PaginatedResponse<DepartmentResponse>>('/departments', { params: query }),
  get: (id: string) =>
    apiClient.get<DepartmentResponse>(`/departments/${id}`),
  create: (data: { name: string; description?: string; isActive?: boolean }) =>
    apiClient.post<DepartmentResponse>('/departments', data),
  update: (id: string, data: Partial<{ name: string; description: string; isActive: boolean }>) =>
    apiClient.put<DepartmentResponse>(`/departments/${id}`, data),
  delete: (id: string) => apiClient.delete(`/departments/${id}`),
}