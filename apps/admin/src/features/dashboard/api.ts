import { apiClient } from '@/lib/api-client'

export interface DashboardStats {
  overview: {
    totalRevenue: number
    subscriptions: number
    sales: number
    activeNow: number
  }
  users: {
    total: number
    active: number
    byRole: { role: string; _count: number }[]
  }
  tasks: {
    total: number
    completed: number
    byStatus: { status: string; _count: number }[]
  }
  recentUsers: {
    id: string
    firstName: string
    lastName: string
    email: string
    createdAt: string
  }[]
  recentTasks: {
    id: string
    title: string
    status: string
    priority: string
    createdAt: string
  }[]
}

export interface AnalyticsData {
  totalClicks: number
  uniqueVisitors: number
  bounceRate: string
  avgSession: string
  totalUsers: number
  referrers: { name: string; value: number }[]
  devices: { name: string; value: number }[]
}

export const dashboardApi = {
  getStats: () => apiClient.get<DashboardStats>('/dashboard/stats'),
  getAnalytics: () => apiClient.get<AnalyticsData>('/dashboard/analytics'),
}
