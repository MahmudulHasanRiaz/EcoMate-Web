import { Shield, UserCheck, Users, CreditCard } from 'lucide-react'
import { type UserStatus } from './schema'
import { USER_ROLES } from '../constants'

export const callTypes = new Map<UserStatus, string>([
  ['active', 'bg-teal-100/30 text-teal-900 dark:text-teal-200 border-teal-200'],
  ['inactive', 'bg-neutral-300/40 border-neutral-300'],
  ['invited', 'bg-sky-200/40 text-sky-900 dark:text-sky-100 border-sky-300'],
  [
    'suspended',
    'bg-destructive/10 dark:bg-destructive/50 text-destructive dark:text-primary border-destructive/10',
  ],
])

// Staff roles with icons, for the users-table filter and role badges.
// Built from the single source of truth so this list cannot drift from
// features/users/constants.ts (it previously offered only 4 of 7 roles,
// which left packing_assistant/employee/customer rows rendering a blank
// Role cell in the table).
export const roles = USER_ROLES.map((role) => ({
  label: role.label,
  value: role.value,
  icon:
    role.value === 'superadmin'
      ? Shield
      : role.value === 'admin'
        ? UserCheck
        : role.value === 'cashier'
          ? CreditCard
          : Users,
})) as const
