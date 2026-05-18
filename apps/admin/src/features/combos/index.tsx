import { useState } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { useCombosQuery } from './hooks'
import { CombosTable } from './components/combo-table'
import { ComboForm } from './components/combo-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { combosApi, type ComboResponse } from './api'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function Combos() {
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add')
  const [editRow, setEditRow] = useState<ComboResponse | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<ComboResponse | null>(null)

  const { data, isLoading } = useCombosQuery({ page: pagination.pageIndex + 1, perPage: pagination.pageSize })

  const deleteMut = useMutation({
    mutationFn: (id: string) => combosApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['combos'] }); setDeleteTarget(null); toast.success('Combo deleted'); },
  })

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Combos</h2>
            <p className='text-muted-foreground'>Manage product bundles and combo deals.</p>
          </div>
          <Button onClick={() => { setFormMode('add'); setEditRow(undefined); setFormOpen(true); }}>
            <Plus className='h-4 w-4 mr-1' /> Add Combo
          </Button>
        </div>
        <CombosTable
          data={data?.data || []}
          pageCount={data?.meta?.totalPages || 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          isLoading={isLoading}
          onEdit={(row) => { setEditRow(row); setFormMode('edit'); setFormOpen(true); }}
          onDelete={(row) => setDeleteTarget(row)}
        />
      </Main>

      <ComboForm open={formOpen} onOpenChange={setFormOpen} currentRow={editRow} mode={formMode} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title='Delete Combo'
        desc={`Are you sure you want to delete "${deleteTarget?.name}"?`}
        confirmText='Delete'
        destructive
        handleConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />
    </>
  )
}
