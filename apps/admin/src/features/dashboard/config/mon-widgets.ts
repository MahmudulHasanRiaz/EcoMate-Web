import type { WidgetConfig } from '../types'
import { TodayKpiRow } from '../widgets/TodayKpiRow'
import { RevenueChart } from '../widgets/RevenueChart'
import { OrderStatusChart } from '../widgets/OrderStatusChart'
import { TopProducts } from '../widgets/TopProducts'
import { NewCustomers } from '../widgets/NewCustomers'
import { LowStockAlert } from '../widgets/LowStockAlert'
import { RecentOrders } from '../widgets/RecentOrders'
import { ActivityLog } from '../widgets/ActivityLog'

export const monWidgets: WidgetConfig[] = [
  { id: 'today-kpi', component: TodayKpiRow, minRole: 'manager', defaultSpan: 4, sizes: { xl: 4 }, title: "Today's KPIs" },
  { id: 'revenue', component: RevenueChart, minRole: 'admin', defaultSpan: 2, sizes: { xl: 2 }, title: 'Revenue' },
  { id: 'order-status', component: OrderStatusChart, minRole: 'manager', defaultSpan: 1, sizes: { xl: 1 }, title: 'Order Status' },
  { id: 'top-products', component: TopProducts, minRole: 'manager', defaultSpan: 1, sizes: { xl: 1 }, title: 'Top Products' },
  { id: 'new-customers', component: NewCustomers, minRole: 'manager', defaultSpan: 1, sizes: { xl: 1 }, title: 'New Customers' },
  { id: 'low-stock', component: LowStockAlert, minRole: 'manager', defaultSpan: 1, sizes: { xl: 1 }, title: 'Low Stock' },
  { id: 'recent-orders', component: RecentOrders, minRole: 'manager', defaultSpan: 2, sizes: { xl: 2 }, title: 'Recent Orders' },
  { id: 'activity', component: ActivityLog, minRole: 'moderator', defaultSpan: 2, sizes: { xl: 2 }, title: 'Activity Log' },
]
