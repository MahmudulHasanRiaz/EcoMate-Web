import { apiClient } from '@/lib/api-client'
import type { OrderSummary, LowStockItem, TopProduct, StatusCount, RevenueByMethod, NewCustomer, PendingRefund, TodayKpi, ActivityEntry } from './types'

export interface DashboardStats {
  totalRevenue: number
  totalOrders: number
  totalCustomers: number
  totalProducts: number
  recentOrders: OrderSummary[]
}

export interface AnalyticsData {
  ordersLast30Days: number
  revenueLast30Days: number
  totalClicks: number
  uniqueVisitors: number
  bounceRate: string
}

function dateParams(startDate?: string, endDate?: string): string {
  const p = new URLSearchParams()
  if (startDate) p.set('startDate', startDate)
  if (endDate) p.set('endDate', endDate)
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export const dashboardApi = {
  getStats: (startDate?: string, endDate?: string) => apiClient.get<DashboardStats>(`/dashboard/stats${dateParams(startDate, endDate)}`),
  getAnalytics: (startDate?: string, endDate?: string) => apiClient.get<AnalyticsData>(`/dashboard/analytics${dateParams(startDate, endDate)}`),
  getPendingOrders: (startDate?: string, endDate?: string) => apiClient.get<OrderSummary[]>(`/dashboard/pending-orders${dateParams(startDate, endDate)}`),
  getLowStockProducts: () => apiClient.get<LowStockItem[]>('/dashboard/low-stock'),
  getTopProducts: (startDate?: string, endDate?: string) => apiClient.get<TopProduct[]>(`/dashboard/top-products${dateParams(startDate, endDate)}`),
  getOrderStatusDistribution: (startDate?: string, endDate?: string) => apiClient.get<StatusCount[]>(`/dashboard/order-status-distribution${dateParams(startDate, endDate)}`),
  getRevenueByPaymentMethod: (startDate?: string, endDate?: string) => apiClient.get<RevenueByMethod[]>(`/dashboard/revenue-by-payment${dateParams(startDate, endDate)}`),
  getNewCustomers: (startDate?: string, endDate?: string) => apiClient.get<NewCustomer[]>(`/dashboard/new-customers${dateParams(startDate, endDate)}`),
  getPendingRefunds: () => apiClient.get<PendingRefund[]>('/dashboard/pending-refunds'),
  getPendingDispatch: () => apiClient.get<OrderSummary[]>('/dashboard/pending-dispatch'),
  getPendingPayments: () => apiClient.get<any[]>('/dashboard/pending-payments'),
  getTodayKpi: () => apiClient.get<TodayKpi>('/dashboard/today-kpi'),
  getActivityLog: () => apiClient.get<ActivityEntry[]>('/dashboard/activity-log'),
}
