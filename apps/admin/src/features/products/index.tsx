import { useState } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Plus, Upload } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { useProductsQuery } from './hooks'
import { ProductsTable } from './components/products-table'
import { ProductForm } from './components/product-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { productsApi } from './api'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { type ProductResponse } from './api'

export function Products() {
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add')
  const [editRow, setEditRow] = useState<ProductResponse | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<ProductResponse | null>(null)

  const { data, isLoading } = useProductsQuery({ page: pagination.pageIndex + 1, perPage: pagination.pageSize })

  const deleteMut = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setDeleteTarget(null); toast.success('Product deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || err?.message || 'Failed to delete product'); },
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
            <h2 className='text-2xl font-bold tracking-tight'>Products</h2>
            <p className='text-muted-foreground'>Manage products, inventory, and variants.</p>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='outline' asChild>
              <Link to='/op/import-products'><Upload className='h-4 w-4 mr-1' /> Import</Link>
            </Button>
            <Button onClick={() => { setFormMode('add'); setEditRow(undefined); setFormOpen(true); }}>
              <Plus className='h-4 w-4 mr-1' /> Add Product
            </Button>
          </div>
        </div>
        <ProductsTable
          data={data?.data || []}
          pageCount={data?.meta?.totalPages || 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          isLoading={isLoading}
          onEdit={(row) => { setEditRow(row); setFormMode('edit'); setFormOpen(true); }}
          onDelete={(row) => setDeleteTarget(row)}
        />
      </Main>

      <ProductForm open={formOpen} onOpenChange={setFormOpen} currentRow={editRow} mode={formMode} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title='Delete Product'
        desc={`Are you sure you want to delete "${deleteTarget?.name}"? This will also remove it from any combos.`}
        confirmText='Delete'
        destructive
        isLoading={deleteMut.isPending}
        handleConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />
    </>
  )
}
