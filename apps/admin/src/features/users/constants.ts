/** Staff roles assignable when creating or editing a user account. */
export const USER_ROLES = [
  { value: 'superadmin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'packing_assistant', label: 'Packing Assistant' },
  { value: 'employee', label: 'Employee' },
  { value: 'customer', label: 'Customer' },
] as const

export const USER_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  USER_ROLES.map((r) => [r.value, r.label])
)