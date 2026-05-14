import { apiClient } from '@/lib/api-client'

export interface TaskResponse {
  id: string
  displayId: string
  title: string
  status: string
  label: string
  priority: string
  assignee?: string | null
  description?: string | null
  dueDate?: string | null
  createdById: string
  createdAt: string
  updatedAt: string
  createdBy?: { id: string; firstName: string; lastName: string; email: string }
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const tasksApi = {
  list: (query?: {
    page?: number
    perPage?: number
    search?: string
    status?: string
    label?: string
    priority?: string
    sort?: string
    order?: string
  }) => apiClient.get<PaginatedResponse<TaskResponse>>('/tasks', { params: query }),

  get: (id: string) => apiClient.get<TaskResponse>(`/tasks/${id}`),

  create: (data: {
    title: string
    status: string
    label: string
    priority: string
    assignee?: string
    description?: string
    dueDate?: string
  }) => apiClient.post<TaskResponse>('/tasks', data),

  update: (id: string, data: Partial<{
    title: string
    status: string
    label: string
    priority: string
    assignee: string
    description: string
    dueDate: string
  }>) => apiClient.put<TaskResponse>(`/tasks/${id}`, data),

  delete: (id: string) => apiClient.delete(`/tasks/${id}`),

  bulkDelete: (ids: string[]) => apiClient.post('/tasks/bulk-delete', { ids }),

  bulkUpdate: (ids: string[], update: { status?: string; priority?: string }) =>
    apiClient.post('/tasks/bulk-update', { ids, ...update }),
}
