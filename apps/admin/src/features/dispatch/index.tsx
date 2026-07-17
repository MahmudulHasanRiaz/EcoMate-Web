import { useState, useEffect, useRef } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useDispatchList, useDispatchMutations } from './hooks'
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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  const [createOpen, setCreateOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data, isLoading } = useDispatchList({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    search: debouncedSearch || undefined,
  })

  const { remove } = useDispatchMutations()

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
          isLoading={isLoading}
          onDelete={(id) => setDeleteId(id)}
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
