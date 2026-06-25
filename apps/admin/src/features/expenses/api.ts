import { apiClient } from '@/lib/api-client'

export interface ExpenseResponse {
  id: string
  description: string
  categoryId: string
  category: { id: string; name: string; slug: string; color?: string | null }
  amount: number
  taxAmount?: number | null
  expenseDate: string
  paymentMethod?: string | null
  referenceNo?: string | null
  notes?: string | null
  receiptUrl?: string | null
  createdAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface CategorySummary {
  category: { id: string; name: string; slug: string }
  total: number
  count: number
}

export const expensesApi = {
  list: (query?: { page?: number; perPage?: number; sort?: string; order?: string }) =>
    apiClient.get<PaginatedResponse<ExpenseResponse>>('/expenses', { params: query }),

  create: (data: {
    description: string
    categoryId: string
    amount: number
    taxAmount?: number
    expenseDate: string
    paymentMethod?: string
    referenceNo?: string
    notes?: string
  }) => apiClient.post<ExpenseResponse>('/expenses', data),

  update: (id: string, data: Partial<{
    description: string
    categoryId: string
    amount: number
    taxAmount: number
    expenseDate: string
    paymentMethod: string
    referenceNo: string
    notes: string
  }>) => apiClient.put<ExpenseResponse>(`/expenses/${id}`, data),

  delete: (id: string) => apiClient.delete(`/expenses/${id}`),

  summary: (query?: { from?: string; to?: string }) =>
    apiClient.get<CategorySummary[]>('/expenses/summary', { params: query }),
}
