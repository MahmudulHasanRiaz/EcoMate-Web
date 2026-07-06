'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const PERMISSIONS = {
  DASHBOARD:   ['view_analytics', 'view_financial_summary'],
  USER_MGMT:   ['view_users', 'create_users', 'edit_users', 'delete_users'],
  CUSTOMER:    ['view_customers', 'edit_customers', 'delete_customers'],
  EMPLOYEE:    ['view_employees', 'create_employees', 'edit_employees',
                 'delete_employees', 'manage_designations', 'manage_presets'],
  SALES:       ['create_orders', 'view_orders', 'refund_orders', 'apply_discounts'],
  INVENTORY:   ['view_products', 'create_products', 'edit_products',
                 'delete_products', 'manage_stock'],
  SETTINGS:    ['view_system_settings', 'modify_integrations'],
} as const

const MODULE_LABELS: Record<string, string> = {
  DASHBOARD: 'Dashboard',
  USER_MGMT: 'User Management',
  CUSTOMER: 'Customer Management',
  EMPLOYEE: 'Employee Management',
  SALES: 'Sales / POS',
  INVENTORY: 'Inventory Management',
  SETTINGS: 'System Settings',
}

const PERMISSION_LABELS: Record<string, string> = {
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
}

type PermissionCheckboxMatrixProps = {
  selected: string[]
  onChange: (permissions: string[]) => void
}

export function PermissionCheckboxMatrix({ selected, onChange }: PermissionCheckboxMatrixProps) {
  const selectedSet = new Set(selected)

  const togglePermission = (key: string) => {
    const next = new Set(selectedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(Array.from(next))
  }

  const toggleModule = (module: string, permissions: readonly string[]) => {
    const allSelected = permissions.every((p) => selectedSet.has(p))
    const next = new Set(selectedSet)
    for (const p of permissions) {
      if (allSelected) next.delete(p)
      else next.add(p)
    }
    onChange(Array.from(next))
  }

  return (
    <div className='space-y-6'>
      {Object.entries(PERMISSIONS).map(([module, perms]) => {
        const allSelected = perms.every((p) => selectedSet.has(p))
        const someSelected = perms.some((p) => selectedSet.has(p))

        return (
          <div key={module} className='space-y-2'>
            <div className='flex items-center gap-2 border-b pb-1'>
              <Checkbox
                id={`select-all-${module}`}
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={() => toggleModule(module, perms)}
              />
              <Label
                htmlFor={`select-all-${module}`}
                className='text-sm font-semibold cursor-pointer'
              >
                {MODULE_LABELS[module] || module}
              </Label>
              <Button
                variant='ghost'
                size='sm'
                className='ml-auto text-xs text-muted-foreground'
                onClick={() => toggleModule(module, perms)}
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className='grid grid-cols-2 gap-2 pl-2'>
              {perms.map((perm) => (
                <div key={perm} className='flex items-center gap-2'>
                  <Checkbox
                    id={perm}
                    checked={selectedSet.has(perm)}
                    onCheckedChange={() => togglePermission(perm)}
                  />
                  <Label htmlFor={perm} className='text-sm cursor-pointer'>
                    {PERMISSION_LABELS[perm] || perm}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
