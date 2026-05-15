import { apiClient } from '@/lib/api-client'

export interface CustomerResponse {
  id: string
  firstName: string
  lastName: string
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

export interface CustomersQuery {
  page?: number
  perPage?: number
  search?: string
  sort?: string
  order?: string
}

export interface OrderSummary {
  totalOrders: number
  totalSpent: number
  lastOrderDate: string | null
  recentOrders: Array<{
    id: string
    total: number
    status: string
    createdAt: string
  }>
}

export const customersApi = {
  list: (query?: CustomersQuery) =>
    apiClient.get<PaginatedResponse<CustomerResponse>>('/users', {
      params: { ...query, role: 'customer' },
    }),

  getOrderSummary: (phone: string) =>
    apiClient.get<OrderSummary>(`/customers/order-summary?phone=${phone}`),
}
