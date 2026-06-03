import { useState, useMemo } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Plus, Upload, Trash2, CheckCircle, XCircle, Loader2 } from 'lucide-react'
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
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { productsApi } from './api'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { type ProductResponse } from './api'
import { categoriesApi } from '@/features/categories/api'
import { MultiSearchableSelect, type MultiSearchableOption } from '@/components/ui/multi-searchable-select'

export function Products() {
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add')
  const [editRow, setEditRow] = useState<ProductResponse | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<ProductResponse | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkAction, setBulkAction] = useState<'delete' | 'activate' | 'deactivate' | null>(null)
  const [filterCategoryId, setFilterCategoryId] = useState<string[]>([])

  const { data: allCats } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list().then(r => Array.isArray(r.data) ? r.data : []),
  })

  const categoryFilterOptions = useMemo(() => {
    const flatten = (items: any[], depth: number): MultiSearchableOption[] => {
      const result: MultiSearchableOption[] = []
      for (const c of items) {
        result.push({ id: c.id, label: c.name, depth })
        if (c.children?.length) result.push(...flatten(c.children, depth + 1))
      }
      return result
    }
    return flatten(allCats || [], 0)
  }, [allCats])

  const { data, isLoading } = useProductsQuery({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    categoryId: filterCategoryId[0] || undefined,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setDeleteTarget(null); toast.success('Product deleted'); },
    onError: (err: any) => { toast.error(err?.response?.data?.message || err?.message || 'Failed to delete product'); },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => productsApi.bulkDelete(ids),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setBulkAction(null); setSelectedIds([]);
      toast.success(`${res.success} product(s) deleted${res.failed ? `, ${res.failed} failed` : ''}`);
      if (res.errors?.length) console.error('Bulk delete errors:', res.errors);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Bulk delete failed'),
  })

  const bulkUpdateMut = useMutation({
    mutationFn: ({ ids, data }: { ids: string[]; data: any }) => productsApi.bulkUpdate(ids, data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setBulkAction(null); setSelectedIds([]);
      toast.success(`${res.success} product(s) updated${res.failed ? `, ${res.failed} failed` : ''}`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Bulk update failed'),
  })

  const handleBulkAction = () => {
    if (!bulkAction || selectedIds.length === 0) return
    if (bulkAction === 'delete') bulkDeleteMut.mutate(selectedIds)
    else if (bulkAction === 'activate') bulkUpdateMut.mutate({ ids: selectedIds, data: { isActive: true } })
    else if (bulkAction === 'deactivate') bulkUpdateMut.mutate({ ids: selectedIds, data: { isActive: false } })
  }

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      productsApi.update(id, { isActive }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update status'),
  })

  const isBulkPending = bulkDeleteMut.isPending || bulkUpdateMut.isPending

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

        {/* Filters */}
        <div className='flex items-center gap-4'>
          <div className='w-72'>
            <MultiSearchableSelect
              options={categoryFilterOptions}
              value={filterCategoryId}
              onChange={setFilterCategoryId}
              placeholder='Filter by category...'
              searchPlaceholder='Search categories...'
            />
          </div>
          {filterCategoryId.length > 0 && (
            <Button variant='ghost' size='sm' onClick={() => setFilterCategoryId([])}>
              Clear filter
            </Button>
          )}
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.length > 0 && (
          <div className='flex items-center gap-3 px-4 py-2.5 bg-muted/50 border rounded-md'>
            <span className='text-sm font-medium'>{selectedIds.length} selected</span>
            <div className='flex items-center gap-2 ml-auto'>
              <Button
                variant='outline' size='sm'
                onClick={() => setBulkAction('activate')}
                disabled={isBulkPending}
              >
                <CheckCircle className='h-4 w-4 mr-1.5 text-green-600' />
                Activate
              </Button>
              <Button
                variant='outline' size='sm'
                onClick={() => setBulkAction('deactivate')}
                disabled={isBulkPending}
              >
                <XCircle className='h-4 w-4 mr-1.5 text-amber-600' />
                Deactivate
              </Button>
              <Button
                variant='outline' size='sm'
                className='text-destructive hover:text-destructive'
                onClick={() => setBulkAction('delete')}
                disabled={isBulkPending}
              >
                <Trash2 className='h-4 w-4 mr-1.5' />
                Delete
              </Button>
              <Button variant='ghost' size='sm' onClick={() => setSelectedIds([])} disabled={isBulkPending}>
                Clear
              </Button>
            </div>
          </div>
        )}

        <ProductsTable
          data={data?.data || []}
          pageCount={data?.meta?.totalPages || 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          isLoading={isLoading}
          onEdit={(row) => { setEditRow(row); setFormMode('edit'); setFormOpen(true); }}
          onDelete={(row) => setDeleteTarget(row)}
          onToggleActive={(row, active) => toggleActiveMut.mutate({ id: row.id, isActive: active })}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
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

      <ConfirmDialog
        open={!!bulkAction}
        onOpenChange={() => setBulkAction(null)}
        title={
          bulkAction === 'delete' ? 'Delete Selected Products' :
          bulkAction === 'activate' ? 'Activate Selected Products' :
          'Deactivate Selected Products'
        }
        desc={`Are you sure you want to ${bulkAction === 'delete' ? 'delete' : bulkAction === 'activate' ? 'activate' : 'deactivate'} ${selectedIds.length} product(s)?`}
        confirmText={bulkAction === 'delete' ? 'Delete' : bulkAction === 'activate' ? 'Activate' : 'Deactivate'}
        destructive={bulkAction === 'delete'}
        isLoading={isBulkPending}
        handleConfirm={handleBulkAction}
      />
    </>
  )
}
