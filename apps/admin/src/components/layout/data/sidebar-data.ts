import {
  LayoutDashboard, Monitor, ListTodo, Package, Palette, Gift, Ruler,
  Users, ShieldCheck, HelpCircle, Percent,
  RefreshCw, Truck, AlertTriangle, Coins, Settings, Upload, FileText,
  Building2, ShoppingCart, Receipt, Bell,
  Megaphone, UserPlus, UserCog, DollarSign, BookOpen, Store
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
        { title: 'Tasks', url: '/op/tasks', icon: ListTodo, feature: 'admin_tasks' },
        {
          title: 'Products',
          icon: Package,
          feature: 'admin_products',
          items: [
            { title: 'All Products', url: '/op/products' },
            { title: 'Combos', url: '/op/combos', icon: Gift, feature: 'admin_combos' },
            { title: 'Categories', url: '/op/categories' },
            { title: 'Brands', url: '/op/brands', feature: 'admin_brands' },
            { title: 'Tags', url: '/op/tags' },
            { title: 'Attributes', url: '/op/attributes', icon: Palette },
            { title: 'Size Charts', url: '/op/size-charts', icon: Ruler, feature: 'admin_size_charts' },
          ],
        },
        {
          title: 'Inventory',
          icon: AlertTriangle,
          feature: 'admin_inventory',
          items: [
            { title: 'All Inventory', url: '/op/inventory' },
            { title: 'Stock Overview', url: '/op/inventory/overview' },
            { title: 'Valuation', url: '/op/inventory/valuation', feature: 'admin_inventory_valuation' },
            { title: 'Warehouses', url: '/op/inventory/warehouses', icon: Building2, feature: 'admin_warehouses' },
          ],
        },
        {
          title: 'Orders',
          icon: ListTodo,
          feature: 'admin_orders',
          items: [
            { title: 'All Orders', url: '/op/orders' },
            { title: 'Incomplete Leads', url: '/op/orders/incomplete-leads', feature: 'admin_incomplete_orders' },
            { title: 'Reviews', url: '/op/reviews', feature: 'admin_reviews' },
          ],
        },

        {
          title: 'Dispatch',
          icon: Truck,
          feature: 'admin_dispatch',
          items: [
            { title: 'Dispatch List', url: '/op/dispatch' },
            { title: 'Duplication Review', url: '/op/dispatch/duplicate-review' },
          ],
        },
        { title: 'Customers', url: '/op/customers', icon: Users, feature: 'admin_customers' },
        { title: 'Payments', url: '/op/payments', icon: Coins, feature: 'admin_payments' },
        { title: 'Refunds', url: '/op/refunds', icon: RefreshCw, feature: 'admin_refunds' },
        { title: 'Coupons', url: '/op/coupons', icon: Percent, feature: 'admin_coupons' },
        { title: 'Suppliers', url: '/op/suppliers', icon: Building2, feature: 'admin_suppliers' },
        { title: 'Purchase Orders', url: '/op/purchases', icon: ShoppingCart, feature: 'admin_purchases' },
        {
          title: 'Expenses',
          icon: Receipt,
          feature: 'admin_expenses',
          items: [
            { title: 'All Expenses', url: '/op/expenses' },
            { title: 'Categories', url: '/op/expense-categories' },
          ],
        },
        {
          title: 'Accounting',
          icon: BookOpen,
          feature: 'admin_accounting',
          items: [
            { title: 'Chart of Accounts', url: '/op/accounting' },
            { title: 'Journal Entries', url: '/op/accounting/journal-entries' },
            { title: 'Reports', url: '/op/accounting/reports' },
          ],
        },
        {
          title: 'Marketing',
          icon: Megaphone,
          feature: 'admin_email_campaigns',
          items: [
            { title: 'Campaigns', url: '/op/campaigns', icon: Megaphone },
            { title: 'Product Catalogs', url: '/op/product-feeds', icon: Upload, feature: 'admin_product_feeds' },
          ],
        },
        { title: 'Referrals', url: '/op/referrals', icon: UserPlus, feature: 'admin_referrals' },
        {
          title: 'Employees',
          icon: UserCog,
          feature: 'admin_employees',
          items: [
            { title: 'All Employees', url: '/op/employees' },
            { title: 'Create Employee', url: '/op/employees/create' },
            { title: 'Designations', url: '/op/employees/designations' },
            { title: 'Access Presets', url: '/op/employees/presets' },
          ],
        },
        { title: 'Payroll', url: '/op/payroll', icon: DollarSign, feature: 'admin_payroll' },
        { title: 'Landing Pages', url: '/op/landing-pages', icon: FileText, feature: 'admin_landing_pages' },
        { title: 'POS Terminal', url: '/pos', icon: Store, feature: 'pos_system' },
        { title: 'Blocked', url: '/op/blocked', icon: ShieldCheck, feature: 'admin_blocking' },
        { title: 'Media Gallery', url: '/op/media', icon: Monitor, feature: 'admin_media' },
      ],
    },
    // ===== MONITORING / ADMIN PANEL =====
    {
      title: '',
      panel: 'monitoring',
      items: [
        { title: 'Dashboard', url: '/mon/overview', icon: LayoutDashboard },
        { title: 'Analytics', url: '/mon/analytics', icon: Monitor, feature: 'admin_analytics' },
        { title: 'User Management', url: '/mon/users', icon: Users, feature: 'admin_users' },
        { title: 'Pages', url: '/mon/pages', icon: FileText, feature: 'admin_cms_pages' },
        { title: 'Blocking Settings', url: '/mon/blocking-settings', icon: ShieldCheck, feature: 'admin_blocking' },
        { title: 'Notifications', url: '/mon/notifications', icon: Bell, feature: 'admin_notifications' },
        { title: 'Product Catalogs', url: '/mon/marketing/catalog', icon: Megaphone, feature: 'admin_product_feeds' },
      ],
    },

    // ===== SHARED FOOTER =====
    {
      title: 'Secondary',
      items: [
        { title: 'Settings', url: '/mon/settings/general', icon: Settings, panel: 'monitoring', feature: 'admin_settings' },
        { title: 'Help Center', url: '/op/help-center', icon: HelpCircle, panel: 'operational', feature: 'admin_help_center' },
        { title: 'Help Center', url: '/mon/help-center', icon: HelpCircle, panel: 'monitoring', feature: 'admin_help_center' },
      ],
    },
  ],
}
