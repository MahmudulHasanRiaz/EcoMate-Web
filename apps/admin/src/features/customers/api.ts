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

export interface CustomerDetail {
  customer: {
    id: string
    firstName: string
    lastName: string
    username: string
    email: string
    phoneNumber: string
    lastIp: string | null
    status: string
    role: string
    createdAt: string
    updatedAt: string
  }
  summary: {
    totalOrders: number
    totalSpent: number
    lastOrderDate: string | null
  }
  recentOrders: RecentOrder[]
}

export interface BlockedIp {
  id: string
  ip: string
  reason: string | null
  blockedAt: string
  blockedBy: string | null
}

export const customersApi = {
  list: (query?: CustomersQuery) =>
    apiClient.get<PaginatedResponse<CustomerResponse>>('/users', {
      params: { ...query, role: 'customer' },
    }),

  getOrderSummary: (phone: string) =>
    apiClient.get<OrderSummary>(`/customers/order-summary?phone=${phone}`),

  getById: (id: string) =>
    apiClient.get<CustomerDetail>(`/customers/${id}`).then(r => r.data),

  blockPhone: (id: string) =>
    apiClient.post(`/customers/${id}/block`).then(r => r.data),

  unblockPhone: (id: string) =>
    apiClient.post(`/customers/${id}/unblock`).then(r => r.data),
}

export const blockedIpsApi = {
  list: () =>
    apiClient.get<BlockedIp[]>('/blocked-ips').then(r => r.data),

  create: (ip: string, reason?: string) =>
    apiClient.post('/blocked-ips', { ip, reason }).then(r => r.data),

  remove: (id: string) =>
    apiClient.delete(`/blocked-ips/${id}`).then(r => r.data),
}
