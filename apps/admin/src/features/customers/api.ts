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

interface OrderStatusInfo {
  name: string
  color: string
}

interface RecentOrder {
  id: string
  displayId: string
  total: number
  statusId: string
  createdAt: string
  status: OrderStatusInfo
}

interface CustomerInfo {
  id: string
  firstName: string
  lastName: string
  phoneNumber: string
}

interface OrderSummaryData {
  totalOrders: number
  totalSpent: number
  lastOrderDate: string | null
}

export interface OrderSummary {
  customer: CustomerInfo | null
  summary: OrderSummaryData | null
  recentOrders: RecentOrder[]
}

export const customersApi = {
  list: (query?: CustomersQuery) =>
    apiClient.get<PaginatedResponse<CustomerResponse>>('/users', {
      params: { ...query, role: 'customer' },
    }),

  getOrderSummary: (phone: string) =>
    apiClient.get<OrderSummary>(`/customers/order-summary?phone=${phone}`),
}
