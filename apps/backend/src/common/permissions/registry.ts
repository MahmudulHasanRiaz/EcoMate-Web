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
  INVENTORY: [
    'view_products',
    'create_products',
    'edit_products',
    'delete_products',
    'manage_stock',
  ],
  SETTINGS: ['view_system_settings', 'modify_integrations'],
} as const;

export type PermissionKey =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number];

export function getAllPermissions(): string[] {
  return Object.values(PERMISSIONS).flat();
}

export function getPermissionLabel(key: string): string {
  const labels: Record<string, string> = {
    view_analytics: 'View Analytics',
    view_financial_summary: 'View Financial Summary',
    view_users: 'View Users',
    create_users: 'Create Users',
    edit_users: 'Edit Users',
    delete_users: 'Delete Users',
    view_customers: 'View Customers',
    edit_customers: 'Edit Customers',
    delete_customers: 'Delete Customers',
    view_employees: 'View Employees',
    create_employees: 'Create Employees',
    edit_employees: 'Edit Employees',
    delete_employees: 'Delete Employees',
    manage_designations: 'Manage Designations',
    manage_presets: 'Manage Access Presets',
    create_orders: 'Create Orders',
    view_orders: 'View Orders',
    refund_orders: 'Refund Orders',
    apply_discounts: 'Apply Discounts',
    view_products: 'View Products',
    create_products: 'Create Products',
    edit_products: 'Edit Products',
    delete_products: 'Delete Products',
    manage_stock: 'Manage Stock',
    view_system_settings: 'View System Settings',
    modify_integrations: 'Modify Integrations',
  };
  return (
    labels[key] ||
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function getModuleLabel(key: string): string {
  const labels: Record<string, string> = {
    DASHBOARD: 'Dashboard',
    USER_MGMT: 'User Management',
    CUSTOMER: 'Customer Management',
    EMPLOYEE: 'Employee Management',
    SALES: 'Sales / POS',
    INVENTORY: 'Inventory Management',
    SETTINGS: 'System Settings',
  };
  return labels[key] || key;
}
