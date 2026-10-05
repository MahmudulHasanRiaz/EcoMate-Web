import type { WidgetConfig } from '../types'
import { OperationalKpiStrip } from '../widgets/OperationalKpiStrip'
import { OrderStatusChart } from '../widgets/OrderStatusChart'
import { NewCustomers } from '../widgets/NewCustomers'
import { LowStockAlert } from '../widgets/LowStockAlert'
import { RecentOrders } from '../widgets/RecentOrders'
import { ActivityLog } from '../widgets/ActivityLog'

/**
 * Monitoring Dashboard = now / what needs attention (operational health,
 * in-flight orders, exceptions, recent activity). Historical financial
 * analysis — revenue trends, payment-method revenue, product P&L/margins —
 * lives canonically in Analytics (/mon/analytics) and is intentionally
 * absent here, so no metric is kept twice.
 */
export const monWidgets: WidgetConfig[] = [
  { id: 'today-kpi', component: OperationalKpiStrip, minRole: 'employee', defaultSpan: 4, sizes: { xl: 4 }, title: 'Operational KPIs' },
  { id: 'order-status', component: OrderStatusChart, minRole: 'employee', defaultSpan: 1, sizes: { xl: 1 }, title: 'Order Status' },
  { id: 'new-customers', component: NewCustomers, minRole: 'employee', defaultSpan: 1, sizes: { xl: 1 }, title: 'New Customers' },
  { id: 'low-stock', component: LowStockAlert, minRole: 'employee', defaultSpan: 1, sizes: { xl: 1 }, title: 'Low Stock' },
  { id: 'recent-orders', component: RecentOrders, minRole: 'employee', defaultSpan: 2, sizes: { xl: 2 }, title: 'Recent Orders' },
  { id: 'activity', component: ActivityLog, minRole: 'employee', defaultSpan: 2, sizes: { xl: 2 }, title: 'Activity Log' },
]
