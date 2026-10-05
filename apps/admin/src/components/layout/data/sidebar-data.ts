import {
  LayoutDashboard, Monitor, ListTodo, Package, Palette, Gift, Ruler,
  Users, ShieldCheck, HelpCircle, Percent,
  RefreshCw, Truck, AlertTriangle, Coins, Settings, Upload, FileText,
  Building2, ShoppingCart, Receipt, Bell,
  Megaphone, UserPlus, UserCog, DollarSign, BookOpen, Store, ShieldAlert,
  HardDrive, Target, Plug, Wallet, BarChart3, CreditCard, CalendarDays,
  CalendarCheck, LifeBuoy, ScanLine, KeyRound, Clock, TrendingUp,
} from 'lucide-react'
import { type SidebarData, type HueName, type NavItem } from '../types'

/** Section label + icon-chip hue for a group of items. */
const sec = (label: string, hue: HueName) => ({ label, hue })

/** Attach a section to an item (presentational grouping only). */
function inSection(item: NavItem, label: string, hue: HueName): NavItem {
  return { ...item, section: sec(label, hue) }
}

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
        // ── Sales ──
        inSection({
          title: 'Orders', icon: ListTodo, feature: 'admin_orders',
          items: [
            { title: 'All Orders', url: '/op/orders' },
            { title: 'Incomplete Leads', url: '/op/orders/incomplete-leads', feature: 'admin_incomplete_orders' },
            { title: 'Reviews', url: '/op/reviews', feature: 'admin_reviews' },
          ],
        }, 'Sales', 'info'),
        inSection({
          title: 'Dispatch', icon: Truck, feature: 'admin_dispatch',
          items: [
            { title: 'Dispatch List', url: '/op/dispatch' },
            { title: 'Duplication Review', url: '/op/dispatch/duplicate-review' },
          ],
        }, 'Sales', 'info'),
        inSection({ title: 'Scanner', url: '/op/scanner', icon: ScanLine, feature: 'admin_barcode_search' }, 'Sales', 'info'),
        inSection({ title: 'Customers', url: '/op/customers', icon: Users, feature: 'admin_customers' }, 'Sales', 'info'),
        inSection({ title: 'Payments', url: '/op/payments', icon: Coins, feature: 'admin_payments' }, 'Sales', 'info'),
        inSection({ title: 'Refunds', url: '/op/refunds', icon: RefreshCw, feature: 'admin_refunds' }, 'Sales', 'info'),
        inSection({ title: 'Courier Settlement', url: '/op/courier-settlement', icon: Wallet, feature: 'admin_courier_settlement' }, 'Sales', 'info'),
        // ── Catalog ──
        inSection({
          title: 'Products', icon: Package, feature: 'admin_products',
          items: [
            { title: 'All Products', url: '/op/products' },
            { title: 'Combos', url: '/op/combos', icon: Gift, feature: 'admin_combos' },
            { title: 'Categories', url: '/op/categories' },
            { title: 'Brands', url: '/op/brands', feature: 'admin_brands' },
            { title: 'Tags', url: '/op/tags' },
            { title: 'Attributes', url: '/op/attributes', icon: Palette },
            { title: 'Size Charts', url: '/op/size-charts', icon: Ruler, feature: 'admin_size_charts' },
          ],
        }, 'Catalog', 'cyan'),
        inSection({
          title: 'Inventory', icon: AlertTriangle, feature: 'admin_inventory',
          items: [
            { title: 'Stock', url: '/op/inventory' },
            { title: 'Overview', url: '/op/inventory/overview' },
            { title: 'Adjustments', url: '/op/inventory/adjustments' },
            { title: 'Reservations', url: '/op/inventory/physical/reservations' },
            { title: 'Transfers', url: '/op/inventory/transfers' },
            { title: 'Valuation', url: '/op/inventory/valuation', feature: 'admin_inventory_valuation' },
            { title: 'Reports', url: '/op/inventory/reports' },
            { title: 'Movement History', url: '/op/inventory/history' },
            { title: 'Warehouses', url: '/op/inventory/warehouses', feature: 'admin_warehouses' },
            { title: 'Bin Locations', url: '/op/inventory/bin-locations', feature: 'admin_warehouses' },
            { title: 'Warehouse Hierarchy', url: '/op/inventory/hierarchy', feature: 'admin_warehouses' },
          ],
        }, 'Catalog', 'cyan'),
        inSection({ title: 'Suppliers', url: '/op/suppliers', icon: Building2, feature: 'admin_suppliers' }, 'Catalog', 'cyan'),
        inSection({ title: 'Purchase Orders', url: '/op/purchases', icon: ShoppingCart, feature: 'admin_purchases' }, 'Catalog', 'cyan'),
        // ── Growth ──
        inSection({ title: 'Coupons', url: '/op/coupons', icon: Percent, feature: 'admin_coupons' }, 'Growth', 'violet'),
        inSection({
          title: 'Marketing', icon: Megaphone, feature: 'admin_email_campaigns',
          items: [{ title: 'Campaigns', url: '/op/campaigns', icon: Megaphone }],
        }, 'Growth', 'violet'),
        inSection({
          title: 'Marketing Attribution', icon: Target, feature: 'marketing_attribution',
          items: [
            { title: 'Dashboard', url: '/op/marketing', icon: LayoutDashboard },
            { title: 'Connections', url: '/op/marketing/connections', icon: Plug },
            { title: 'Ad Accounts', url: '/op/marketing/ad-accounts', icon: Monitor },
            { title: 'Campaigns', url: '/op/marketing/campaigns', icon: Megaphone },
            { title: 'Funding', url: '/op/marketing/funding', icon: Wallet },
            { title: 'Payments', url: '/op/marketing/payments', icon: CreditCard },
            { title: 'Attribution', url: '/op/marketing/attribution', icon: Target },
            { title: 'Reports', url: '/op/marketing/reports', icon: BarChart3 },
            { title: 'Help', url: '/op/marketing/help', icon: HelpCircle },
          ],
        }, 'Growth', 'violet'),
        inSection({ title: 'Referrals', url: '/op/referrals', icon: UserPlus, feature: 'admin_referrals' }, 'Growth', 'violet'),
        inSection({ title: 'Landing Pages', url: '/op/landing-pages', icon: FileText, feature: 'admin_landing_pages' }, 'Growth', 'violet'),
        // ── Finance ──
        inSection({
          title: 'Expenses', icon: Receipt, feature: 'admin_expenses',
          items: [
            { title: 'All Expenses', url: '/op/expenses' },
            { title: 'Categories', url: '/op/expense-categories' },
          ],
        }, 'Finance', 'warning'),
        inSection({
          title: 'Accounting', icon: BookOpen, feature: 'admin_accounting',
          items: [
            { title: 'Chart of Accounts', url: '/op/accounting' },
            { title: 'Journal Entries', url: '/op/accounting/journal-entries' },
            { title: 'Reports', url: '/op/accounting/reports' },
          ],
        }, 'Finance', 'warning'),
        // ── Tools ──
        inSection({ title: 'POS Terminal', url: '/pos', icon: Store, feature: 'pos_system' }, 'Tools', 'neutral'),
        inSection({ title: 'Tasks', url: '/op/tasks', icon: ListTodo, feature: 'admin_tasks' }, 'Tools', 'neutral'),
        inSection({ title: 'Blocked', url: '/op/blocked', icon: ShieldCheck, feature: 'admin_blocking' }, 'Tools', 'neutral'),
        inSection({ title: 'Media Gallery', url: '/op/media', icon: Monitor, feature: 'admin_media' }, 'Tools', 'neutral'),
      ],
    },
    // ===== HR MANAGEMENT PANEL =====
    {
      title: '',
      panel: 'hr',
      items: [
        // ── People ──
        inSection({ title: 'Dashboard', url: '/hr/overview', icon: LayoutDashboard, feature: 'admin_hr', permissions: ['view_hr'] }, 'People', 'violet'),
        inSection({ title: 'Performance', url: '/hr/performance', icon: TrendingUp, feature: 'admin_hr', permissions: ['view_hr'] }, 'People', 'violet'),
        inSection({
          title: 'Employees', icon: UserCog, feature: 'admin_employees', permissions: ['view_hr'],
          items: [
            { title: 'All Employees', url: '/hr/employees' },
            { title: 'Create Employee', url: '/hr/employees/create' },
            { title: 'Access Presets', url: '/hr/presets', feature: 'admin_access_presets', permissions: ['manage_presets'] },
            { title: 'Departments', url: '/hr/employees/departments', feature: 'admin_employees' },
            { title: 'Designations', url: '/hr/employees/designations' },
          ],
        }, 'People', 'violet'),
        // ── Payroll ──
        inSection({ title: 'Payroll', url: '/hr/payroll', icon: DollarSign, feature: 'admin_payroll', permissions: ['view_hr'] }, 'Payroll', 'warning'),
        inSection({ title: 'Commissions', url: '/hr/commissions', icon: Percent, feature: 'admin_payroll', permissions: ['view_hr'] }, 'Payroll', 'warning'),
        // ── Time ──
        inSection({ title: 'Leave', url: '/hr/leave', icon: CalendarDays, feature: 'admin_hr', permissions: ['view_hr'] }, 'Time', 'cyan'),
        inSection({ title: 'Attendance', url: '/hr/attendance', icon: CalendarCheck, feature: 'admin_hr', permissions: ['manage_attendance'] }, 'Time', 'cyan'),
        inSection({ title: 'Shifts', url: '/hr/shifts', icon: Clock, feature: 'admin_hr', permissions: ['view_hr'] }, 'Time', 'cyan'),
        // ── System ──
        inSection({ title: 'Settings', url: '/hr/settings', icon: Settings, feature: 'admin_hr', permissions: ['manage_hr_settings'] }, 'System', 'neutral'),
        inSection({ title: 'Help', url: '/hr/help', icon: LifeBuoy, feature: 'admin_hr', permissions: ['view_hr'] }, 'System', 'neutral'),
      ],
    },
    // ===== MONITORING / ADMIN PANEL =====
    {
      title: 'Dashboard & Analytics',
      panel: 'monitoring',
      items: [
        { title: 'Dashboard', url: '/mon/overview', icon: LayoutDashboard },
        // ── Overview ──
        inSection({
          title: 'Analytics', icon: BarChart3, feature: 'admin_analytics',
          items: [
            { title: 'Business Overview', url: '/mon/analytics' },
            { title: 'Sales & Orders', url: '/mon/analytics/sales' },
            { title: 'Products', url: '/mon/analytics/products' },
            { title: 'Customers', url: '/mon/analytics/customers' },
            { title: 'Marketing', url: '/mon/analytics/marketing' },
            { title: 'Inventory', url: '/mon/analytics/inventory' },
            { title: 'Expenses', url: '/mon/analytics/expenses' },
            { title: 'Help', url: '/mon/analytics/help' },
          ],
        }, 'Overview', 'info'),
        // ── Security ──
        inSection({ title: 'Security Dashboard', url: '/mon/security', icon: ShieldAlert }, 'Security', 'danger'),
        inSection({ title: 'Blocking Settings', url: '/mon/blocking-settings', icon: ShieldCheck, feature: 'admin_blocking' }, 'Security', 'danger'),
        // ── Access Control ──
        // User administration lives here rather than under HR, since it governs
        // who can reach the app — not who is on payroll. Access Presets stay
        // under Employees in the HR panel, next to the employees they govern.
        // `view_hr` is retained: it is the permission that gates employee/payroll
        // data, and user administration is part of that surface. Dropping it
        // would expose this group to anyone holding the feature alone.
        inSection({
          title: 'User Management', icon: Users, feature: 'admin_users', permissions: ['view_hr'],
          items: [
            { title: 'All Users', url: '/hr/users' },
            { title: 'User Creation', url: '/mon/users/create' },
          ],
        }, 'Access', 'violet'),
        // ── System ──
        inSection({ title: 'Backup & Restore', url: '/mon/backup', icon: HardDrive }, 'System', 'neutral'),
        inSection({ title: 'Pages', url: '/mon/pages', icon: FileText, feature: 'admin_cms_pages' }, 'System', 'neutral'),
        inSection({ title: 'Notifications', url: '/mon/notifications', icon: Bell, feature: 'admin_notifications' }, 'System', 'neutral'),
        inSection({ title: 'Product Catalogs', url: '/mon/marketing/catalog', icon: Upload, feature: 'admin_product_feeds' }, 'System', 'neutral'),
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
