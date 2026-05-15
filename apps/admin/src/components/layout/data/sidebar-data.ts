import {
  LayoutDashboard, Monitor, ListTodo, Package, Palette, Settings,
  Wrench, UserCog, Bell, Users, ShieldCheck, HelpCircle, Percent,
  RefreshCw, Truck, AlertTriangle, Coins,
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
    { title: 'Management', panel: 'operational', items: [
      { title: 'Users', url: '/users', icon: Users },
      { title: 'Media Gallery', url: '/media', icon: Monitor },
    ]},

    // ===== MONITORING / ADMIN PANEL =====
    { title: 'Finance', panel: 'monitoring', items: [
      { title: 'Coupons', url: '/coupons', icon: Percent },
      { title: 'Refunds', url: '/refunds', icon: RefreshCw },
    ]},
    { title: 'Logistics', panel: 'monitoring', items: [
      { title: 'Shipments', url: '/shipments', icon: Truck },
      { title: 'Inventory', url: '/inventory', icon: AlertTriangle },
    ]},
    { title: 'Settings', panel: 'monitoring', icon: Settings, items: [
      { title: 'Profile', url: '/settings', icon: UserCog },
      { title: 'Account', url: '/settings/account', icon: Wrench },
      { title: 'Appearance', url: '/settings/appearance', icon: Palette },
      { title: 'Notifications', url: '/settings/notifications', icon: Bell },
      { title: 'Display', url: '/settings/display', icon: Monitor },
    ]},
    { title: 'System', panel: 'monitoring', items: [
      { title: 'Storage', url: '/settings/storage', icon: Wrench },
      { title: 'Gateways', url: '/settings/gateways', icon: ShieldCheck },
      { title: 'Order Status', url: '/settings/order-statuses', icon: RefreshCw },
      { title: 'Help Center', url: '/help-center', icon: HelpCircle },
    ]},
  ],
}
