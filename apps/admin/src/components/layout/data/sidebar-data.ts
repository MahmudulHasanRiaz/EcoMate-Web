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
      { title: 'Dashboard', url: '/op', icon: LayoutDashboard },
      { title: 'Tasks', url: '/op/tasks', icon: ListTodo },
    ]},
    { title: 'Catalog', panel: 'operational', items: [
      { title: 'Products', icon: Package, items: [
        { title: 'All Products', url: '/op/products', icon: Package },
        { title: 'Categories', url: '/op/categories', icon: Package },
        { title: 'Attributes', url: '/op/attributes', icon: Palette },
      ]},
    ]},
    { title: 'Sales', panel: 'operational', items: [
      { title: 'Orders', url: '/op/orders', icon: ListTodo },
      { title: 'Customers', url: '/op/customers', icon: Users },
      { title: 'Payments', url: '/op/payments', icon: Coins },
    ]},
    { title: 'Content', panel: 'operational', items: [
      { title: 'Media Gallery', url: '/op/media', icon: Monitor },
    ]},

    // ===== MONITORING / ADMIN PANEL =====
    { title: 'Administration', panel: 'monitoring', items: [
      { title: 'Users', url: '/mon/users', icon: Users },
      { title: 'Settings', url: '/mon/settings', icon: Settings },
    ]},
    { title: 'Monitoring', panel: 'monitoring', items: [
      { title: 'Inventory', url: '/mon/inventory', icon: AlertTriangle },
      { title: 'Logs', url: '/mon/settings/system', icon: Settings },
    ]},
    { title: 'Operations', panel: 'monitoring', items: [
      { title: 'Coupons', url: '/mon/coupons', icon: Percent },
      { title: 'Refunds', url: '/mon/refunds', icon: RefreshCw },
      { title: 'Shipments', url: '/mon/shipments', icon: Truck },
    ]},
    { title: 'Support', panel: 'monitoring', items: [
      { title: 'Help Center', url: '/mon/help-center', icon: HelpCircle },
    ]},
  ],
}
