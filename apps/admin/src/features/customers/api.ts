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
  secondaryPhone?: string | null
  status: OrderStatusInfo
  _count?: { items: number }
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

export interface LinkedPhone {
  phone: string
  source: string
  isPrimary: boolean
  blocked: boolean
  blockId: string | null
}

export interface CustomerIp {
  ip: string
  lastSeen: string
  orderCount: number
  lastOrder: string | null
  blocked: boolean
  blockId: string | null
  blockReason: string | null
}

export interface CustomerAddressRow {
  id: string
  type: 'SHIPPING' | 'BILLING'
  label: string | null
  isDefault: boolean
  fullName: string
  phone: string
  addressLine: string
  area: string | null
  thana: string | null
  district: string | null
  division: string | null
  postalCode: string | null
  createdAt: string
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
  stats: {
    delivered: number
    cancelled: number
    successRate: number
    avgOrderValue: number
  }
  phones: LinkedPhone[]
  ips: CustomerIp[]
  addresses: {
    shipping: CustomerAddressRow[]
    billing: CustomerAddressRow[]
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
    apiClient.get<BlockedIp[]>('/blocked-entries', { params: { type: 'ip' } }).then(r => r.data),

  create: (ip: string, reason?: string) =>
    apiClient.post('/blocked-entries', { type: 'ip', value: ip, reason }).then(r => r.data),

  remove: (id: string) =>
    apiClient.post(`/blocked-entries/ip/${id}/unblock`).then(r => r.data),
}

export interface CustomerCreditEntry {
  id: string
  customerId: string
  orderId?: string | null
  paymentId?: string | null
  amount: number | string
  reason: string
  createdBy?: string | null
  createdAt: string
}

export interface CustomerCreditProfile {
  balance: number | string
  entries: CustomerCreditEntry[]
}

export const creditApi = {
  /** Live balance + mini-ledger (newest first). */
  get: (customerId: string) =>
    apiClient.get<CustomerCreditProfile>(`/customers/${customerId}/credit`).then(r => r.data),
  /** Staff apply credit against an order (clamped server-side, never negative). */
  apply: (orderId: string, amount: number) =>
    apiClient.post(`/orders/${orderId}/apply-credit`, { amount }).then(r => r.data),
}

export const blockedPhonesApi = {
  create: (phone: string, reason?: string) =>
    apiClient.post('/blocked-entries', { type: 'phone', value: phone, reason }).then(r => r.data),

  remove: (id: string) =>
    apiClient.post(`/blocked-entries/phone/${id}/unblock`).then(r => r.data),
}
