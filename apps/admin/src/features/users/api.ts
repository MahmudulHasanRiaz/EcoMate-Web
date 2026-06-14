import { apiClient } from '@/lib/api-client'

export interface UserResponse {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  status: string
  role: string
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

export interface UsersQuery {
  page?: number
  perPage?: number
  search?: string
  status?: string
  role?: string
  sort?: string
  order?: string
}

export const usersApi = {
  list: (query?: UsersQuery) =>
    apiClient.get<PaginatedResponse<UserResponse>>('/users', { params: query }),

  get: (id: string) =>
    apiClient.get<UserResponse>(`/users/${id}`),

  create: (data: {
    firstName: string
    lastName: string
    username: string
    email: string
    phoneNumber: string
    password: string
    role: string
  }) => apiClient.post<UserResponse>('/users', data),

  update: (id: string, data: Partial<{
    firstName: string
    lastName: string
    username: string
    email: string
    phoneNumber: string
    status: string
    role: string
    password: string
  }>) => apiClient.put<UserResponse>(`/users/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/users/${id}`),

  bulkDelete: (ids: string[]) =>
    apiClient.post('/users/bulk-delete', { ids }),

  bulkUpdate: (ids: string[], status: string) =>
    apiClient.post('/users/bulk-update', { ids, status }),

  invite: (email: string, role: string, desc?: string) =>
    apiClient.post('/users/invite', { email, role, desc }),

  findByEmail: (email: string) =>
    apiClient.get<UserResponse>(`/users/by-email/${encodeURIComponent(email)}`),
}
