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
      { title: 'Products', url: '/op/products', icon: Package },
      { title: 'Categories', url: '/op/categories', icon: Package },
      { title: 'Attributes', url: '/op/attributes', icon: Palette },
      { title: 'Inventory', url: '/op/inventory', icon: AlertTriangle },
    ]},
    { title: 'Sales', panel: 'operational', items: [
      { title: 'Orders', url: '/op/orders', icon: ListTodo },
      { title: 'Customers', url: '/op/customers', icon: Users },
      { title: 'Refunds', url: '/op/refunds', icon: RefreshCw },
    ]},
    { title: 'Marketing', panel: 'operational', items: [
      { title: 'Coupons', url: '/op/coupons', icon: Percent },
      { title: 'Campaigns', url: '/op/campaigns', icon: Monitor }, // Placeholder URL
    ]},
    { title: 'Finance', panel: 'operational', items: [
      { title: 'Payments', url: '/op/payments', icon: Coins },
      { title: 'Transactions', url: '/op/transactions', icon: CreditCard }, // Placeholder URL
    ]},
    { title: 'Logistics', panel: 'operational', items: [
      { title: 'Shipments', url: '/op/shipments', icon: Truck },
    ]},
    { title: 'Content', panel: 'operational', items: [
      { title: 'Media Gallery', url: '/op/media', icon: Monitor },
    ]},
    { title: 'Communications', panel: 'operational', items: [
      { title: 'Chats', url: '/op/chats', icon: RefreshCw }, // Placeholder Icon
      { title: 'Apps', url: '/op/apps', icon: Package },
    ]},
    // ===== MONITORING / ADMIN PANEL =====
    { title: 'Overview', panel: 'monitoring', items: [
      { title: 'Dashboard', url: '/mon', icon: LayoutDashboard },
      { title: 'Analytics', url: '/mon/analytics', icon: Monitor },
    ]},
    { title: 'Administration', panel: 'monitoring', items: [
      { title: 'User Management', url: '/mon/users', icon: Users },
      { title: 'Activity Logs', url: '/mon/activity-logs', icon: ListTodo },
    ]},

    // ===== SHARED FOOTER (Moved below) =====
    { title: 'Secondary', items: [
      { title: 'Settings', url: '/op/settings/personal', icon: Settings, panel: 'operational' },
      { title: 'Settings', url: '/mon/settings/system', icon: Settings, panel: 'monitoring' },
      { title: 'Help Center', url: '/mon/help-center', icon: HelpCircle },
    ]},
  ],
}
