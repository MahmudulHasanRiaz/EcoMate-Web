import {
  LayoutDashboard, Monitor, ListTodo, Package, Palette, Gift, Ruler,
  Users, ShieldCheck, HelpCircle, Percent,
  RefreshCw, Truck, AlertTriangle, Coins, Settings, Upload, FileText,
  Building2, ShoppingCart, Receipt, Bell,
  Megaphone, UserPlus, UserCog, DollarSign, BookOpen
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
    {
      title: '',
      panel: 'operational',
      items: [
        { title: 'Dashboard', url: '/op/overview', icon: LayoutDashboard },
        { title: 'Tasks', url: '/op/tasks', icon: ListTodo },
        {
          title: 'Products',
          icon: Package,
          items: [
            { title: 'All Products', url: '/op/products' },
            { title: 'Combos', url: '/op/combos', icon: Gift },
            { title: 'Categories', url: '/op/categories' },
            { title: 'Brands', url: '/op/brands' },
            { title: 'Tags', url: '/op/tags' },
            { title: 'Attributes', url: '/op/attributes', icon: Palette },
            { title: 'Size Charts', url: '/op/size-charts', icon: Ruler },
          ],
        },
        {
          title: 'Inventory',
          icon: AlertTriangle,
          items: [
            { title: 'All Inventory', url: '/op/inventory' },
            { title: 'Stock Overview', url: '/op/inventory/overview' },
            { title: 'Valuation', url: '/op/inventory/valuation' },
            { title: 'Warehouses', url: '/op/inventory/warehouses', icon: Building2 },
          ],
        },
        {
          title: 'Orders',
          icon: ListTodo,
          items: [
            { title: 'All Orders', url: '/op/orders' },
            { title: 'Incomplete Leads', url: '/op/orders/incomplete-leads' },
            { title: 'Reviews', url: '/op/reviews' },
          ],
        },
        { title: 'Customers', url: '/op/customers', icon: Users },
        { title: 'Payments', url: '/op/payments', icon: Coins },
        { title: 'Shipments', url: '/op/shipments', icon: Truck },
        { title: 'Refunds', url: '/op/refunds', icon: RefreshCw },
        { title: 'Coupons', url: '/op/coupons', icon: Percent },
        { title: 'Suppliers', url: '/op/suppliers', icon: Building2 },
        { title: 'Purchase Orders', url: '/op/purchases', icon: ShoppingCart },
        { title: 'Expenses', url: '/op/expenses', icon: Receipt },
        {
          title: 'Accounting',
          icon: BookOpen,
          items: [
            { title: 'Chart of Accounts', url: '/op/accounting' },
            { title: 'Journal Entries', url: '/op/accounting/journal-entries' },
            { title: 'Reports', url: '/op/accounting/reports' },
          ],
        },
        { title: 'Campaigns', url: '/op/campaigns', icon: Megaphone },
        { title: 'Referrals', url: '/op/referrals', icon: UserPlus },
        { title: 'Employees', url: '/op/employees', icon: UserCog },
        { title: 'Payroll', url: '/op/payroll', icon: DollarSign },
        { title: 'Notifications', url: '/op/notifications', icon: Bell },
        { title: 'Landing Pages', url: '/op/landing-pages', icon: FileText },
        { title: 'Blocked', url: '/op/blocked', icon: ShieldCheck },
        { title: 'Media Gallery', url: '/op/media', icon: Monitor },
      ],
    },
    // ===== MONITORING / ADMIN PANEL =====
    {
      title: '',
      panel: 'monitoring',
      items: [
        { title: 'Dashboard', url: '/mon/overview', icon: LayoutDashboard },
        { title: 'Analytics', url: '/mon/analytics', icon: Monitor },
        { title: 'User Management', url: '/mon/users', icon: Users },
        { title: 'Pages', url: '/mon/pages', icon: FileText },
        { title: 'Blocking Settings', url: '/mon/blocking-settings', icon: ShieldCheck },
      ],
    },

    // ===== SHARED FOOTER =====
    {
      title: 'Secondary',
      items: [
        { title: 'Settings', url: '/mon/settings/general', icon: Settings, panel: 'monitoring' },
        { title: 'Help Center', url: '/op/help-center', icon: HelpCircle, panel: 'operational' },
        { title: 'Help Center', url: '/mon/help-center', icon: HelpCircle, panel: 'monitoring' },
      ],
    },
  ],
}
