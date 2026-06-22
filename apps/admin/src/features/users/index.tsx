import { useState } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { useUsersQuery } from './hooks'
import { UsersDialogs } from './components/users-dialogs'
import { UsersPrimaryButtons } from './components/users-primary-buttons'
import { UsersProvider } from './components/users-provider'
import { UsersTable } from './components/users-table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function Users() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [roleFilter, setRoleFilter] = useState<string>('all_except_customer')

  const { data, isLoading } = useUsersQuery({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    role: roleFilter,
  })

  const handleRoleChange = (val: string) => {
    setRoleFilter(val)
    setPagination(prev => ({ ...prev, pageIndex: 0 }))
  }

  return (
    <UsersProvider>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>User List</h2>
            <p className='text-muted-foreground'>
              Manage your users and their roles here.
            </p>
          </div>
          <UsersPrimaryButtons />
        </div>

        <div className='flex items-center gap-2'>
          <Select value={roleFilter} onValueChange={handleRoleChange}>
            <SelectTrigger className='w-[240px]'>
              <SelectValue placeholder='Select Role' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all_except_customer'>All (Customer Excluded)</SelectItem>
              <SelectItem value='all'>All Users</SelectItem>
              <SelectItem value='superadmin'>Super Admin</SelectItem>
              <SelectItem value='admin'>Admin</SelectItem>
              <SelectItem value='cashier'>Cashier</SelectItem>
              <SelectItem value='manager'>Manager</SelectItem>
              <SelectItem value='customer'>Customer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <UsersTable
          data={data?.data || []}
          pageCount={data?.meta?.totalPages || 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          isLoading={isLoading}
        />
      </Main>

      <UsersDialogs />
    </UsersProvider>
  )
}
