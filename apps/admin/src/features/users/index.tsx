import { useState } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { useUsersQuery } from './hooks'
import { UsersDialogs } from './components/users-dialogs'
import { UsersPrimaryButtons } from './components/users-primary-buttons'
import { UsersProvider } from './components/users-provider'
import { UsersTable } from './components/users-table'

export function Users() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const { data, isLoading } = useUsersQuery({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
  })

  return (
    <UsersProvider>
      <Header fixed>
        <Search className='me-auto' />
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
