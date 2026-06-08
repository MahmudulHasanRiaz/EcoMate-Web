import {
  LayoutDashboard, Monitor, ListTodo, Package, Palette, Gift, Ruler,
  Users, ShieldCheck, HelpCircle, Percent,
  RefreshCw, Truck, AlertTriangle, Coins, Settings,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: 'Admin', email: 'admin@ecomate.com', avatar: '/avatars/avatar.svg' },
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
      {
        title: 'Products',
        icon: Package,
        items: [
          { title: 'All Products', url: '/op/products' },
          { title: 'Combos', url: '/op/combos', icon: Gift },
          { title: 'Categories', url: '/op/categories' },
          { title: 'Tags', url: '/op/tags' },
          { title: 'Attributes', url: '/op/attributes', icon: Palette },
          { title: 'Size Charts', url: '/op/size-charts', icon: Ruler },
        ],
      },
      { title: 'Inventory', url: '/op/inventory', icon: AlertTriangle },
    ]},
    { title: 'Sales', panel: 'operational', items: [
      {
        title: 'Orders',
        icon: ListTodo,
        items: [
          { title: 'All Orders', url: '/op/orders' },
          { title: 'Incomplete Leads', url: '/op/orders/incomplete-leads' },
        ],
      },
      { title: 'Customers', url: '/op/customers', icon: Users },
      { title: 'Refunds', url: '/op/refunds', icon: RefreshCw },
    ]},
    { title: 'Marketing', panel: 'operational', items: [
      { title: 'Coupons', url: '/op/coupons', icon: Percent },
    ]},
    { title: 'Finance', panel: 'operational', items: [
      { title: 'Payments', url: '/op/payments', icon: Coins },
    ]},
    { title: 'Logistics', panel: 'operational', items: [
      { title: 'Shipments', url: '/op/shipments', icon: Truck },
    ]},
    { title: 'Content', panel: 'operational', items: [
      { title: 'Media Gallery', url: '/op/media', icon: Monitor },
    ]},
    // ===== MONITORING / ADMIN PANEL =====
    { title: 'Overview', panel: 'monitoring', items: [
      { title: 'Dashboard', url: '/mon', icon: LayoutDashboard },
      { title: 'Analytics', url: '/mon/analytics', icon: Monitor },
    ]},
    { title: 'Administration', panel: 'monitoring', items: [
      { title: 'User Management', url: '/mon/users', icon: Users },
    ]},

    // ===== SHARED FOOTER (Moved below) =====
    { title: 'Secondary', items: [
      { title: 'Settings', url: '/op/settings/personal', icon: Settings, panel: 'operational' },
      { title: 'Settings', url: '/mon/settings/general', icon: Settings, panel: 'monitoring' },
      { title: 'Help Center', url: '/op/help-center', icon: HelpCircle, panel: 'operational' },
      { title: 'Help Center', url: '/mon/help-center', icon: HelpCircle, panel: 'monitoring' },
    ]},
  ],
}
