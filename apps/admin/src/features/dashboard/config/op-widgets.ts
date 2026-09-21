import type { WidgetConfig } from '../types'
import { OperationalKpiStrip } from '../widgets/OperationalKpiStrip'
import { PendingOrders } from '../widgets/PendingOrders'
import { LowStockAlert } from '../widgets/LowStockAlert'
import { RecentOrders } from '../widgets/RecentOrders'
import { ActivityLog } from '../widgets/ActivityLog'

export const opWidgets: WidgetConfig[] = [
  { id: 'today-kpi', component: OperationalKpiStrip, minRole: 'cashier', defaultSpan: 4, sizes: { xl: 4 }, title: 'Operational KPIs' },
  { id: 'pending-orders', component: PendingOrders, minRole: 'cashier', defaultSpan: 2, sizes: { xl: 2 }, title: 'Pending Orders' },
  { id: 'recent-orders', component: RecentOrders, minRole: 'cashier', defaultSpan: 1, sizes: { xl: 1 }, title: 'Recent Orders' },
  { id: 'activity', component: ActivityLog, minRole: 'cashier', defaultSpan: 1, sizes: { xl: 1 }, title: 'Activity' },
  { id: 'low-stock', component: LowStockAlert, minRole: 'cashier', defaultSpan: 1, sizes: { xl: 1 }, title: 'Low Stock' },
]
