import type { ComponentType } from 'react'

export type RoleKey = 'superadmin' | 'admin' | 'manager' | 'moderator' | 'sales_executive' | 'cashier' | 'customer'

export type DatePresetKey = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom'

/** Operations Dashboard reporting view: Activity (what happened in the period)
 * vs Pipeline (where the period-created cohort stands now). */
export type DashboardView = 'activity' | 'pipeline'

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
  /** Reporting view. Optional (defaults to 'activity') so non-op surfaces
   * and existing callers keep working unchanged. */
  view?: DashboardView
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
  totalAmount?: number
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

/** One order-status tile returned by both operational KPI views. */
export interface OrderStatusCount {
  /** `OrderStatus.name` (e.g. 'Pending', 'Payment Verifying', 'Cancelled'). */
  name: string
  /**
   * Pipeline: cohort orders CURRENTLY in this status.
   * Activity: DISTINCT orders that ENTERED this status during the period
   * ('Pending' is the period's order-creation count).
   */
  count: number
  /** Status colour from `OrderStatus.color` (hex) — used for tile accents. */
  color: string
  /** Lifecycle order for rendering left-to-right. */
  sortOrder: number
}

export interface OperationalKpi {
  newOrders: number
  confirmed: number
  packed: number
  pickedUp: number
  delivered: number
  pendingPayments: number
  pendingRefunds: number
  revenue: number
  /**
   * One entry per CONFIGURED order status, ordered by `sortOrder` — including
   * statuses with zero orders, so the panel can drop empty cards itself.
   */
  statusCounts: OrderStatusCount[]
}
