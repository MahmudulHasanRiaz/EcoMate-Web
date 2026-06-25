import { apiClient } from '@/lib/api-client'

export interface ExpenseCategoryResponse {
  id: string
  name: string
  slug: string
  description?: string | null
  icon?: string | null
  color?: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  _count?: { expenses: number }
}

export const expenseCategoriesApi = {
  list: () => apiClient.get<ExpenseCategoryResponse[]>('/expense-categories'),
  get: (id: string) => apiClient.get<ExpenseCategoryResponse>(`/expense-categories/${id}`),
  create: (data: { name: string; slug: string; description?: string; icon?: string; color?: string; isActive?: boolean; sortOrder?: number }) =>
    apiClient.post<ExpenseCategoryResponse>('/expense-categories', data),
  update: (id: string, data: { name?: string; slug?: string; description?: string; icon?: string; color?: string; isActive?: boolean; sortOrder?: number }) =>
    apiClient.put<ExpenseCategoryResponse>(`/expense-categories/${id}`, data),
  delete: (id: string) => apiClient.delete(`/expense-categories/${id}`),
}
