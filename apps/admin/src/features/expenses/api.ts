import { apiClient } from '@/lib/api-client'

export type ExpenseCategory =
  | 'utilities'
  | 'rent'
  | 'salaries'
  | 'marketing'
  | 'supplies'
  | 'maintenance'
  | 'travel'
  | 'shipping'
  | 'taxes'
  | 'insurance'
  | 'software'
  | 'food_and_beverages'
  | 'office_expenses'
  | 'professional_fees'
  | 'other'

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'utilities', label: 'Utilities' },
  { value: 'rent', label: 'Rent' },
  { value: 'salaries', label: 'Salaries' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'travel', label: 'Travel' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'taxes', label: 'Taxes' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'software', label: 'Software' },
  { value: 'food_and_beverages', label: 'Food & Beverages' },
  { value: 'office_expenses', label: 'Office Expenses' },
  { value: 'professional_fees', label: 'Professional Fees' },
  { value: 'other', label: 'Other' },
]

export interface ExpenseResponse {
  id: string
  description: string
  category: ExpenseCategory
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
  category: ExpenseCategory
  total: number
  count: number
}

export const expensesApi = {
  list: (query?: { page?: number; perPage?: number; sort?: string; order?: string }) =>
    apiClient.get<PaginatedResponse<ExpenseResponse>>('/expenses', { params: query }),

  create: (data: {
    description: string
    category: ExpenseCategory
    amount: number
    taxAmount?: number
    expenseDate: string
    paymentMethod?: string
    referenceNo?: string
    notes?: string
  }) => apiClient.post<ExpenseResponse>('/expenses', data),

  update: (id: string, data: Partial<{
    description: string
    category: ExpenseCategory
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
