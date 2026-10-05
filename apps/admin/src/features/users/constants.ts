/**
 * Staff roles assignable when creating or editing a user account.
 *
 * Single source of truth for the admin UI. `manager` was consolidated into
 * `employee` (the `manager` enum value no longer exists); `customer` is kept
 * so the users screen can still display and filter storefront accounts, but it
 * is not a staff role — a customer can never sign in to the admin app.
 */
export const USER_ROLES = [
  { value: 'superadmin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'employee', label: 'Employee' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'packing_assistant', label: 'Packing Assistant' },
  { value: 'customer', label: 'Customer' },
] as const

/** Roles that can actually hold admin-application access. */
export const STAFF_ROLES = USER_ROLES.filter(
  (r) => r.value !== 'customer'
).map((r) => r.value) as readonly string[]

export const USER_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  USER_ROLES.map((r) => [r.value, r.label])
)