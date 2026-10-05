import {
  PERMISSION_CATALOGUE,
  getAllCatalogueKeys,
} from '../../permissions/permission-catalogue';

/**
 * Legacy flat registry, retained as the shape existing code imports.
 *
 * The permission catalogue (permissions/permission-catalogue.ts) is now the
 * single source of truth: it generates CRUD keys per module and folds in the
 * legacy keys below so nothing already granted in a live database is stripped
 * by `sanitizePermissions`. This object is derived from it rather than
 * hand-maintained, which is how the two lists drifted apart before.
 */
export const PERMISSIONS = {
  DASHBOARD: ['view_analytics', 'view_financial_summary'],
  USER_MGMT: ['view_users', 'create_users', 'edit_users', 'delete_users'],
  CUSTOMER: ['view_customers', 'edit_customers', 'delete_customers'],
  EMPLOYEE: [
    'view_employees',
    'create_employees',
    'edit_employees',
    'delete_employees',
    'manage_designations',
    'manage_presets',
  ],
  SALES: ['create_orders', 'view_orders', 'refund_orders', 'apply_discounts'],
  HR: [
    'view_hr',
    'manage_employees',
    'manage_payroll',
    'manage_commissions',
    'manage_leave',
    'manage_schedule',
    'manage_attendance',
    'manage_hr_settings',
    'manage_attendance_devices',
    'manage_attendance_adjustments',
  ],
  INVENTORY: [
    'view_products',
    'create_products',
    'edit_products',
    'delete_products',
    'manage_stock',
  ],
  SETTINGS: ['view_system_settings', 'modify_integrations'],
  COURIER_SETTLEMENT: [
    'view_courier_settlement',
    'import_courier_settlement',
    'finalize_courier_settlement',
    'adjust_courier_settlement',
  ],
} as const;

/**
 * Every grantable key. Union of the legacy groups above and the generated
 * catalogue, so `sanitizePermissions` accepts both.
 */
export function getAllPermissions(): string[] {
  const legacy = Object.values(PERMISSIONS).flat() as string[];
  return Array.from(new Set([...legacy, ...getAllCatalogueKeys()]));
}

/** All keys the system recognises — the authority for write validation. */
export const ALL_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  getAllPermissions(),
);

export function isKnownPermission(key: string): boolean {
  return ALL_PERMISSION_KEYS.has(key);
}

/** Human label for a permission key, from the catalogue where known. */
export function getPermissionLabel(key: string): string {
  const fromCatalogue = PERMISSION_CATALOGUE.find((e) => e.key === key);
  if (fromCatalogue) return fromCatalogue.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getModuleLabel(key: string): string {
  const labels: Record<string, string> = {
    DASHBOARD: 'Dashboard',
    USER_MGMT: 'User Management',
    CUSTOMER: 'Customer Management',
    EMPLOYEE: 'Employee Management',
    SALES: 'Sales / POS',
    HR: 'HR Management',
    INVENTORY: 'Inventory Management',
    SETTINGS: 'System Settings',
    COURIER_SETTLEMENT: 'Courier Settlement',
  };
  return labels[key] || key;
}
