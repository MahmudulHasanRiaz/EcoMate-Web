import {
  LayoutDashboard, Monitor, ListTodo, Package, Palette,
  Wrench, UserCog, Users, ShieldCheck, HelpCircle, Percent,
  RefreshCw, Truck, AlertTriangle, Coins, Settings, CreditCard,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: 'Admin', email: 'admin@ecomate.com', avatar: '/avatars/shadcn.jpg' },
  teams: [
    { name: 'Operational', logo: Package, plan: 'Day-to-Day Operations' },
    { name: 'Admin', logo: ShieldCheck, plan: 'Monitoring & Settings' },
  ],
  navGroups: [
    // ===== OPERATIONAL PANEL =====
    { title: 'Overview', panel: 'operational', items: [
      { title: 'Dashboard', url: '/', icon: LayoutDashboard },
      { title: 'Tasks', url: '/tasks', icon: ListTodo },
    ]},
    { title: 'Catalog', panel: 'operational', items: [
      { title: 'Products', icon: Package, items: [
        { title: 'All Products', url: '/products', icon: Package },
        { title: 'Categories', url: '/categories', icon: Package },
        { title: 'Attributes', url: '/attributes', icon: Palette },
      ]},
    ]},
    { title: 'Sales', panel: 'operational', items: [
      { title: 'Orders', url: '/orders', icon: ListTodo },
      { title: 'Customers', url: '/customers', icon: Users },
      { title: 'Payments', url: '/payments', icon: Coins },
    ]},
    { title: 'Content', panel: 'operational', items: [
      { title: 'Media Gallery', url: '/media', icon: Monitor },
    ]},

    // ===== MONITORING / ADMIN PANEL =====
    { title: 'Management', panel: 'monitoring', items: [
      { title: 'Users', url: '/users', icon: Users },
      { title: 'Inventory', url: '/inventory', icon: AlertTriangle },
    ]},
    { title: 'Finance', panel: 'monitoring', items: [
      { title: 'Coupons', url: '/coupons', icon: Percent },
      { title: 'Refunds', url: '/refunds', icon: RefreshCw },
    ]},
    { title: 'Logistics', panel: 'monitoring', items: [
      { title: 'Shipments', url: '/shipments', icon: Truck },
    ]},
    { title: 'Settings', panel: 'monitoring', icon: Settings, items: [
      { title: 'Personal', url: '/settings/personal', icon: UserCog },
      { title: 'System', url: '/settings/system', icon: Settings },
      { title: 'Order Status', url: '/settings/system/order-statuses', icon: RefreshCw },
      { title: 'Courier', url: '/settings/system/courier', icon: Truck },
      { title: 'Gateways', url: '/settings/system/gateways', icon: CreditCard },
      { title: 'Storage', url: '/settings/system/storage', icon: Wrench },
      { title: 'Help Center', url: '/help-center', icon: HelpCircle },
    ]},
  ],
}
