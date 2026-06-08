import { apiClient } from '@/lib/api-client'

export interface RecentOrder {
  id: string
  displayId: string
  total: number
  status: string
  itemCount: number
  createdAt: string
}

export interface DashboardStats {
  totalRevenue: number
  totalOrders: number
  totalCustomers: number
  totalProducts: number
  recentOrders: RecentOrder[]
}

export interface AnalyticsData {
  ordersLast30Days: number
  revenueLast30Days: number
  totalClicks: number
  uniqueVisitors: number
  bounceRate: string
}

export const dashboardApi = {
  getStats: () => apiClient.get<DashboardStats>('/dashboard/stats'),
  getAnalytics: () => apiClient.get<AnalyticsData>('/dashboard/analytics'),
}
