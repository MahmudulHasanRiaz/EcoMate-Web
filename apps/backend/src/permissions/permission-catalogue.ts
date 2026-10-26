/**
 * The permission catalogue — single source of truth for what can be granted.
 *
 * Key format is `verb_module` (e.g. `view_orders`), matching every key that
 * already exists in `PERMISSIONS` below. That is deliberate and load-bearing:
 * these strings are persisted in `AccessPreset.permissions` and
 * `better_auth_users.override_permissions`, and `sanitizePermissions` strips
 * anything it does not recognise. Renaming a key to a dotted style
 * (`orders.view`) would silently revoke every grant in a live database, so
 * new keys follow the existing shape instead.
 *
 * CRUD keys per module are generated from the module table rather than written
 * out, so adding a module cannot leave part of its CRUD surface ungrantable.
 * Anything beyond CRUD (approve, refund, finalize, ...) is declared explicitly
 * in `extras` because only a human knows whether it is a real capability.
 */

/** A capability that is not plain CRUD. */
export interface PermissionExtra {
  /** Verb, e.g. `assign`. Combined as `assign_orders`. */
  verb: string;
  label: string;
}

export interface CatalogueModule {
  /** snake_case module key, e.g. `orders`. Forms the suffix of CRUD keys. */
  key: string;
  /** Human label for the whole module. */
  label: string;
  /** Grouping bucket used by the preset editor's sections. */
  group: string;
  /** License feature that gates this module, when one applies. */
  feature?: string;
  /** Emit `view_/create_/edit_/delete_<key>`. False for action-only modules. */
  crud?: boolean;
  /** Non-CRUD capabilities this module exposes. */
  extras?: PermissionExtra[];
}

const CRUD_VERBS = [
  { verb: 'view', label: 'View' },
  { verb: 'create', label: 'Create' },
  { verb: 'edit', label: 'Edit' },
  { verb: 'delete', label: 'Delete' },
] as const;

/**
 * Every module an access preset can grant access to.
 *
 * `crud: false` modules are action surfaces (backup, import, settings) that
 * have no create/update/delete of their own — they are governed by role, and
 * their permissions exist so a preset can still name them explicitly.
 */
export const CATALOGUE_MODULES: CatalogueModule[] = [
  // ── Dashboard & analytics ──────────────────────────────────────────────
  { key: 'analytics', label: 'Analytics', group: 'DASHBOARD', feature: 'admin_analytics', crud: true },

  // ── Users & access ─────────────────────────────────────────────────────
  { key: 'users', label: 'Users', group: 'USER_MGMT', feature: 'admin_staff_users', crud: true },
  { key: 'access_presets', label: 'Access Presets', group: 'USER_MGMT', feature: 'admin_access_presets', crud: true },
  { key: 'permissions', label: 'Permission Catalogue', group: 'USER_MGMT', crud: false,
    extras: [{ verb: 'view', label: 'View Permission Catalogue' }] },

  // ── Customers ──────────────────────────────────────────────────────────
  { key: 'customers', label: 'Customers', group: 'CUSTOMER', feature: 'admin_customers', crud: true },
  { key: 'customer_addresses', label: 'Customer Addresses', group: 'CUSTOMER', crud: true },
  { key: 'customer_reviews', label: 'Reviews', group: 'CUSTOMER', feature: 'admin_reviews', crud: true,
    extras: [{ verb: 'approve', label: 'Approve Reviews' }] },

  // ── Employees & org ────────────────────────────────────────────────────
  { key: 'employees', label: 'Employees', group: 'EMPLOYEE', feature: 'admin_employees', crud: true },
  { key: 'departments', label: 'Departments', group: 'EMPLOYEE', crud: true },
  { key: 'designations', label: 'Designations', group: 'EMPLOYEE', crud: true },
  { key: 'employee_bank_accounts', label: 'Employee Bank Accounts', group: 'EMPLOYEE', crud: true },

  // ── Sales ──────────────────────────────────────────────────────────────
  { key: 'orders', label: 'Orders', group: 'SALES', feature: 'admin_orders', crud: true,
    extras: [
      { verb: 'assign', label: 'Assign Orders' },
      { verb: 'change_status', label: 'Change Order Status' },
      { verb: 'apply_discount', label: 'Apply Discounts' },
      { verb: 'refund', label: 'Refund Orders' },
      { verb: 'trash', label: 'Trash Orders' },
    ] },
  { key: 'pos', label: 'POS', group: 'SALES', feature: 'admin_pos', crud: false,
    extras: [
      { verb: 'manage_pos_sessions', label: 'Manage POS Sessions' },
      { verb: 'view_pos_analytics', label: 'View POS Analytics' },
    ] },
  { key: 'packing', label: 'Packing', group: 'SALES', feature: 'admin_packing', crud: false,
    extras: [{ verb: 'manage_packing', label: 'Manage Packing' }] },
  { key: 'checkout_leads', label: 'Checkout Leads', group: 'SALES', feature: 'admin_leads', crud: true },
  { key: 'refunds', label: 'Refunds', group: 'SALES', crud: true },
  { key: 'payments', label: 'Payments', group: 'SALES', crud: true,
    extras: [{ verb: 'approve', label: 'Approve payment verifications' }] },
  { key: 'gateways', label: 'Payment Gateways', group: 'SALES', crud: true },
  { key: 'accounts', label: 'Accounts', group: 'SALES', crud: true },
  { key: 'accounting', label: 'Accounting', group: 'SALES', crud: false,
    extras: [
      { verb: 'view', label: 'View Accounting' },
      { verb: 'post_journal', label: 'Post Journal Entries' },
    ] },
  { key: 'commissions', label: 'Commissions', group: 'SALES', feature: 'admin_commissions', crud: true },

  // ── HR ─────────────────────────────────────────────────────────────────
  { key: 'hr', label: 'HR Dashboard', group: 'HR', feature: 'admin_hr', crud: false,
    extras: [{ verb: 'view', label: 'View HR' }] },
  { key: 'payroll', label: 'Payroll', group: 'HR', feature: 'admin_payroll', crud: true },
  { key: 'hr_leave', label: 'Leave', group: 'HR', feature: 'admin_hr', crud: true },
  { key: 'hr_schedule', label: 'Schedules', group: 'HR', feature: 'admin_hr', crud: true },
  { key: 'hr_shifts', label: 'Shifts', group: 'HR', feature: 'admin_hr', crud: true },
  { key: 'hr_attendance', label: 'Attendance', group: 'HR', feature: 'admin_hr', crud: true },
  { key: 'hr_attendance_devices', label: 'Attendance Devices', group: 'HR', feature: 'admin_hr', crud: true },
  { key: 'hr_settings', label: 'HR Settings', group: 'HR', feature: 'admin_hr', crud: false },
  { key: 'hr_ledgers', label: 'HR Ledgers', group: 'HR', feature: 'admin_hr', crud: false,
    extras: [{ verb: 'view', label: 'View HR Ledgers' }] },

  // ── Inventory & products ───────────────────────────────────────────────
  { key: 'products', label: 'Products', group: 'INVENTORY', feature: 'admin_products', crud: true,
    extras: [{ verb: 'manage_stock', label: 'Manage Stock' }] },
  { key: 'categories', label: 'Categories', group: 'INVENTORY', feature: 'admin_products', crud: true },
  { key: 'brands', label: 'Brands', group: 'INVENTORY', feature: 'admin_products', crud: true },
  { key: 'tags', label: 'Tags', group: 'INVENTORY', feature: 'admin_products', crud: true },
  { key: 'attributes', label: 'Attributes', group: 'INVENTORY', feature: 'admin_products', crud: true },
  { key: 'combos', label: 'Combos', group: 'INVENTORY', feature: 'admin_products', crud: true },
  { key: 'size_charts', label: 'Size Charts', group: 'INVENTORY', crud: true },
  { key: 'warehouses', label: 'Warehouses', group: 'INVENTORY', feature: 'admin_inventory', crud: true },
  { key: 'inventory', label: 'Stock & Transfers', group: 'INVENTORY', feature: 'admin_inventory', crud: true,
    extras: [
      { verb: 'approve_transfer', label: 'Approve Transfers' },
      { verb: 'adjust_stock', label: 'Adjust Physical Stock' },
    ] },
  { key: 'suppliers', label: 'Suppliers', group: 'INVENTORY', feature: 'admin_purchases', crud: true },
  { key: 'purchases', label: 'Purchases', group: 'INVENTORY', feature: 'admin_purchases', crud: true },
  { key: 'opening_balances', label: 'Opening Balances', group: 'INVENTORY', crud: true },

  // ── Fulfilment ─────────────────────────────────────────────────────────
  { key: 'shipment', label: 'Shipments', group: 'FULFILMENT', crud: true },
  { key: 'shipping', label: 'Shipping Methods', group: 'FULFILMENT', crud: true },
  { key: 'delivery_areas', label: 'Delivery Areas', group: 'FULFILMENT', crud: true },
  { key: 'dispatch', label: 'Dispatch', group: 'FULFILMENT', feature: 'admin_dispatch', crud: false,
    extras: [{ verb: 'manage_dispatch', label: 'Manage Dispatch' }] },
  { key: 'couriers', label: 'Couriers', group: 'FULFILMENT', feature: 'admin_couriers', crud: true },
  { key: 'courier_settlement', label: 'Courier Settlement', group: 'FULFILMENT', feature: 'admin_courier_settlement', crud: false,
    extras: [
      { verb: 'view', label: 'View Courier Settlement' },
      { verb: 'import', label: 'Import Courier Settlement' },
      { verb: 'finalize', label: 'Finalize Courier Settlement' },
      { verb: 'adjust', label: 'Adjust Courier Settlement' },
    ] },
  { key: 'tracking', label: 'Order Tracking', group: 'FULFILMENT', crud: false,
    extras: [
      { verb: 'view', label: 'View Order Tracking' },
      { verb: 'manage_tracking_policy', label: 'Manage Tracking Policy' },
      { verb: 'replay_tracking', label: 'Replay Tracking Events' },
    ] },
  { key: 'rtn', label: 'Returns (RTO)', group: 'FULFILMENT', crud: true },
  { key: 'exchange', label: 'Exchange Orders', group: 'FULFILMENT', crud: true },
  // Action-only surface: listing COD-mismatch alerts is a read, resolving one
  // is a distinct act — no create/update/delete of its own.
  { key: 'cod_mismatch', label: 'COD Mismatches', group: 'FULFILMENT', crud: false,
    extras: [
      { verb: 'view', label: 'View COD Mismatches' },
      { verb: 'resolve', label: 'Resolve COD Mismatches' },
    ] },

  // ── Marketing & content ────────────────────────────────────────────────
  { key: 'campaigns', label: 'Campaigns', group: 'MARKETING', crud: true },
  { key: 'coupons', label: 'Coupons', group: 'MARKETING', crud: true },
  // Same license surface as coupons: the admin menu is one "Coupons &
  // Discounts" entry (discounts.controller.ts @RequiresFeature admin_coupons).
  { key: 'discounts', label: 'Discounts', group: 'MARKETING', feature: 'admin_coupons', crud: true },
  { key: 'landing_pages', label: 'Landing Pages', group: 'MARKETING', crud: true },
  { key: 'cms_pages', label: 'CMS Pages', group: 'MARKETING', crud: true },
  { key: 'referrals', label: 'Referrals', group: 'MARKETING', crud: true },
  { key: 'sales_channel', label: 'Sales Channels', group: 'MARKETING', crud: true },
  { key: 'expenses', label: 'Expenses', group: 'MARKETING', crud: true },
  { key: 'expense_categories', label: 'Expense Categories', group: 'MARKETING', crud: true },
  { key: 'financial_periods', label: 'Financial Periods', group: 'MARKETING', crud: true },

  // ── Settings & system ──────────────────────────────────────────────────
  { key: 'system_settings', label: 'System Settings', group: 'SETTINGS', crud: true,
    extras: [{ verb: 'modify_integrations', label: 'Modify Integrations' }] },
  { key: 'auth_settings', label: 'Authentication Settings', group: 'SETTINGS', crud: true },
  { key: 'block_settings', label: 'Blocking Settings', group: 'SETTINGS', crud: true },
  { key: 'blocked_entries', label: 'Blocked Entries', group: 'SETTINGS', crud: true },
  { key: 'tasks', label: 'Tasks', group: 'SETTINGS', crud: true },
  { key: 'notifications', label: 'Notifications', group: 'SETTINGS', crud: true },
  { key: 'media', label: 'Media Library', group: 'SETTINGS', crud: true },
  { key: 'backup', label: 'Backup', group: 'SETTINGS', crud: false,
    extras: [{ verb: 'manage_backup', label: 'Manage Backups' }] },
  { key: 'import', label: 'Data Import', group: 'SETTINGS', crud: false,
    extras: [{ verb: 'run_import', label: 'Run Imports' }] },
  { key: 'security', label: 'Security', group: 'SETTINGS', crud: false,
    extras: [{ verb: 'view_security_dashboard', label: 'View Security Dashboard' }] },
  { key: 'mobile_builder', label: 'Mobile Builder', group: 'SETTINGS', crud: true },
  { key: 'license', label: 'License', group: 'SETTINGS', crud: false,
    extras: [{ verb: 'manage', label: 'Manage License Activation' }] },
];

export interface CatalogueEntry {
  key: string;
  label: string;
  module: string;
  moduleLabel: string;
  group: string;
  feature?: string;
}

/**
 * Keys that already exist in live `AccessPreset.permissions` and
 * `better_auth_users.override_permissions` rows but do not follow the
 * generated `verb_module` shape.
 *
 * They must stay in the catalogue verbatim: `sanitizePermissions` drops any
 * key the registry does not know, so omitting one silently revokes a grant
 * somebody is relying on — the preset still shows a tick in the UI while the
 * permission does nothing. New code should prefer the generated CRUD keys;
 * these exist so the migration is lossless.
 */
export const LEGACY_PERMISSION_KEYS: readonly string[] = [
  'view_financial_summary',
  'manage_designations',
  'manage_presets',
  'refund_orders',
  'apply_discounts',
  'manage_employees',
  'manage_payroll',
  'manage_commissions',
  'manage_leave',
  'manage_schedule',
  'manage_attendance',
  'manage_hr_settings',
  'manage_attendance_devices',
  'manage_attendance_adjustments',
  'import_courier_settlement',
  'finalize_courier_settlement',
  'adjust_courier_settlement',
  // Produced as declared extras below, but listed here too so the "every
  // legacy key resolves" contract test covers them explicitly.
  'manage_stock',
  'modify_integrations',
  // Guard keys used verbatim by @Permissions where the verb alone IS the
  // key (same shape as manage_stock above). These are NOT renames of
  // existing grants: the declared extras on the import/security modules
  // generate the doubled keys run_import_import and
  // view_security_dashboard_security, which are left untouched so any
  // existing grant of a doubled key keeps working. The guard keys below
  // are the ones controllers actually check.
  'run_import',
  'view_security_dashboard',
] as const;

const LEGACY_DETAILS: Record<string, { label: string; module: string; group: string }> = {
  view_financial_summary: { label: 'View Financial Summary', module: 'analytics', group: 'DASHBOARD' },
  manage_designations: { label: 'Manage Designations', module: 'designations', group: 'EMPLOYEE' },
  manage_presets: { label: 'Manage Access Presets', module: 'access_presets', group: 'USER_MGMT' },
  refund_orders: { label: 'Refund Orders', module: 'orders', group: 'SALES' },
  apply_discounts: { label: 'Apply Discounts', module: 'orders', group: 'SALES' },
  manage_employees: { label: 'Manage Employees', module: 'employees', group: 'HR' },
  manage_payroll: { label: 'Manage Payroll', module: 'payroll', group: 'HR' },
  manage_commissions: { label: 'Manage Commissions', module: 'commissions', group: 'SALES' },
  manage_leave: { label: 'Manage Leave', module: 'hr_leave', group: 'HR' },
  manage_schedule: { label: 'Manage Schedule', module: 'hr_schedule', group: 'HR' },
  manage_attendance: { label: 'Manage Attendance', module: 'hr_attendance', group: 'HR' },
  manage_hr_settings: { label: 'Manage HR Settings', module: 'hr_settings', group: 'HR' },
  manage_attendance_devices: { label: 'Manage Attendance Devices', module: 'hr_attendance_devices', group: 'HR' },
  manage_attendance_adjustments: { label: 'Manage Attendance Adjustments', module: 'hr_attendance', group: 'HR' },
  import_courier_settlement: { label: 'Import Courier Settlement', module: 'courier_settlement', group: 'FULFILMENT' },
  finalize_courier_settlement: { label: 'Finalize Courier Settlement', module: 'courier_settlement', group: 'FULFILMENT' },
  adjust_courier_settlement: { label: 'Adjust Courier Settlement', module: 'courier_settlement', group: 'FULFILMENT' },
  manage_stock: { label: 'Manage Stock', module: 'inventory', group: 'INVENTORY' },
  modify_integrations: { label: 'Modify Integrations', module: 'system_settings', group: 'SETTINGS' },
  run_import: { label: 'Run Imports', module: 'import', group: 'SETTINGS' },
  view_security_dashboard: { label: 'View Security Dashboard', module: 'security', group: 'SETTINGS' },
};

/** Catalogue entries for the legacy keys, folded into their module. */
const GENERATED_KEYS = new Set(
  CATALOGUE_MODULES.flatMap((mod) => [
    ...(mod.crud ? CRUD_VERBS.map(({ verb }) => `${verb}_${mod.key}`) : []),
    ...(mod.extras ?? []).map((e) => `${e.verb}_${mod.key}`),
  ]),
);

const LEGACY_ENTRIES: CatalogueEntry[] = LEGACY_PERMISSION_KEYS.filter(
  (key) => !GENERATED_KEYS.has(key),
).map((key) => {
  const d = LEGACY_DETAILS[key] ?? { label: key, module: 'misc', group: 'OTHER' };
  const mod = CATALOGUE_MODULES.find((m) => m.key === d.module);
  return {
    key,
    label: d.label,
    module: d.module,
    moduleLabel: mod?.label ?? d.module,
    group: d.group,
    feature: mod?.feature,
  };
});

/** Every grantable permission, flattened. */
export const PERMISSION_CATALOGUE: CatalogueEntry[] = [
  ...CATALOGUE_MODULES.flatMap((mod) => {
    const entries: CatalogueEntry[] = [];
    const push = (key: string, label: string) =>
      entries.push({
        key,
        label,
        module: mod.key,
        moduleLabel: mod.label,
        group: mod.group,
        feature: mod.feature,
      });

    if (mod.crud) {
      for (const { verb, label } of CRUD_VERBS) {
        push(`${verb}_${mod.key}`, `${label} ${mod.label}`);
      }
    }
    for (const extra of mod.extras ?? []) {
      push(`${extra.verb}_${mod.key}`, extra.label);
    }
    return entries;
  }),
  ...LEGACY_ENTRIES,
];

/** All catalogue keys. */
export function getAllCatalogueKeys(): string[] {
  return PERMISSION_CATALOGUE.map((e) => e.key);
}

const CATALOGUE_KEY_SET = new Set(getAllCatalogueKeys());

export function isCatalogueKey(key: string): boolean {
  return CATALOGUE_KEY_SET.has(key);
}

/** The catalogue grouped by module, for the preset editor. */
export function getCatalogueTree() {
  return CATALOGUE_MODULES.map((mod) => ({
    key: mod.key,
    label: mod.label,
    group: mod.group,
    feature: mod.feature ?? null,
    permissions: PERMISSION_CATALOGUE.filter((e) => e.module === mod.key).map(
      (e) => ({ key: e.key, label: e.label }),
    ),
  })).filter((m) => m.permissions.length > 0);
}