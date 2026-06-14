import type { ComponentType } from 'react'

export type RoleKey = 'superadmin' | 'admin' | 'manager' | 'moderator' | 'sales_executive' | 'cashier' | 'customer'

export type DatePresetKey = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom'

export interface DateRange {
  start: Date
  end: Date
}

export interface WidgetProps {
  dateRange: DateRange
  preset: DatePresetKey
  userRole: RoleKey
  isLoading: boolean
  error?: Error
}

export interface WidgetConfig {
  id: string
  title: string
  description?: string
  component: ComponentType<WidgetProps>
  minRole: RoleKey
  defaultSpan: number
  sizes?: {
    sm?: number
    md?: number
    lg?: number
    xl?: number
  }
  refreshInterval?: number
}

export interface DashboardRoute {
  route: 'mon' | 'op'
}

export interface DatePreset {
  key: DatePresetKey
  label: string
  getRange: () => DateRange
}

export interface KpiData {
  label: string
  value: string | number
  subtext?: string
  icon: string
  trend?: { direction: 'up' | 'down'; value: string }
  colorClass: string
}

export interface OrderSummary {
  id: string
  displayId: string
  customerName: string
  customerPhone: string
  total: number
  status: string
  itemCount: number
  createdAt: string
}

export interface LowStockItem {
  id: string
  name: string
  sku: string
  stock: number
  lowStockQty: number
}

export interface TopProduct {
  id: string
  name: string
  image: string
  quantity: number
}

export interface StatusCount {
  status: string
  count: number
}

export interface RevenueByMethod {
  method: string
  revenue: number
}

export interface NewCustomer {
  id: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
}

export interface PendingRefund {
  id: string
  order: { displayId: string }
  createdAt: string
  amount: number
}

export interface ActivityEntry {
  id: string
  displayId: string
  status: string
  customerName: string
  updatedAt: string
}

export interface TodayKpi {
  orders: number
  delivered: number
  pendingPayments: number
  pendingRefunds: number
}
