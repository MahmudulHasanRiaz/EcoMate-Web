import { useState, useEffect, useRef } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useDispatchList, useDispatchMutations, useDispatchSync } from './hooks'
import { DispatchMetrics } from './dispatch-metrics'
import { DispatchTable } from './dispatch-table'
import { CreateDispatchDialog } from './create-dispatch-dialog'

export function DispatchPage() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search])
  const [statusFilter, setStatusFilter] = useState('')
  const [courierFilter, setCourierFilter] = useState('')

  // Filters are server-side (manual pagination) — any filter/search change
  // must reset to page 1, otherwise results disappear on a filtered page
  // whose page number no longer exists.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }, [statusFilter, courierFilter, debouncedSearch])

  const [createOpen, setCreateOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data, isLoading } = useDispatchList({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    courier: courierFilter || undefined,
  })

  const { remove } = useDispatchMutations()
  const syncMutation = useDispatchSync()

  const activeFilterCount =
    (statusFilter ? 1 : 0) + (courierFilter ? 1 : 0)

  const resetFilters = () => {
    setStatusFilter('')
    setCourierFilter('')
  }

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Dispatch</h2>
            <p className='text-muted-foreground'>
              Manage order dispatches and courier handoffs.
            </p>
          </div>
          <Button className='space-x-1' onClick={() => setCreateOpen(true)}>
            <span>Create</span> <Plus size={18} />
          </Button>
        </div>

        <DispatchMetrics />

        <DispatchTable
          data={data?.data || []}
          total={data?.total || 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          courierFilter={courierFilter}
          onCourierFilterChange={setCourierFilter}
          activeFilterCount={activeFilterCount}
          onResetFilters={resetFilters}
          isLoading={isLoading}
          isSyncing={syncMutation.isPending}
          onDelete={(id) => setDeleteId(id)}
          onSyncSelected={(ids) => syncMutation.mutate(ids)}
        />
      </Main>

      <CreateDispatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <ConfirmDialog
        key='dispatch-delete'
        destructive
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        handleConfirm={() => {
          if (deleteId) {
            remove.mutate(deleteId)
            setDeleteId(null)
          }
        }}
        className='max-w-md'
        title='Delete this dispatch?'
        desc='This action cannot be undone.'
        confirmText='Delete'
      />
    </>
  )
}
