import { useState, useMemo, useEffect, useRef } from 'react'
import type { PaginationState } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Plus, Upload, Trash2, CheckCircle, XCircle, Loader2, Package, Printer, Rocket, FileEdit, Search as SearchIcon, X } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { ManagedStockAdjustmentModal } from './components/managed-stock-adjustment-modal'
import { PriceLabelOptionsModal } from '@/features/print/components/price-label-options-modal'

export function Products() {
  const queryClient = useQueryClient()
  // Persisted page size: with thousands of products operators pick 50/100
  // once and expect it to stick across visits — a reset-to-10 on every mount
  // reads as "rows-per-page doesn't work".
  const [pagination, setPagination] = useState<PaginationState>(() => {
    let pageSize = 10
    try {
      const stored = Number(localStorage.getItem('products-page-size'))
      if ([10, 20, 30, 50, 100].includes(stored)) pageSize = stored
    } catch { /* private mode — fall back to 10 */ }
    return { pageIndex: 0, pageSize }
  })
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'add' | 'edit' | 'duplicate'>('add')
  const [editRow, setEditRow] = useState<ProductResponse | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<ProductResponse | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkAction, setBulkAction] = useState<'delete' | 'activate' | 'deactivate' | null>(null)
  const [filterCategoryId, setFilterCategoryId] = useState<string[]>([])
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false)
  const [adjustmentProductId, setAdjustmentProductId] = useState<string | undefined>()
  const [priceLabelModalOpen, setPriceLabelModalOpen] = useState(false)
  const [duplicateSourceRow, setDuplicateSourceRow] = useState<ProductResponse | undefined>()
  const [listStatus, setListStatus] = useState<'active' | 'draft'>('active')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPagination((p) => ({ ...p, pageIndex: 0 }))
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const { data: allCats } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list().then(r => Array.isArray(r.data) ? r.data : (r.data as any)?.data || []),
  })

  const categoryFilterOptions = useMemo(() => {
    const flat = Array.isArray(allCats) ? allCats : []
    const map = new Map<string, any>()
    for (const c of flat) map.set(c.id, { id: c.id, name: c.name })
    const children = new Map<string, any[]>()
    const roots: any[] = []
    for (const c of flat) {
      if (c.parentId && map.has(c.parentId)) {
        const list = children.get(c.parentId) || []
        list.push(c.id)
        children.set(c.parentId, list)
      } else {
        roots.push(c.id)
      }
    }
    const result: MultiSearchableOption[] = []
    const walk = (ids: string[], depth: number) => {
      for (const id of ids) {
        const c = map.get(id)
        if (!c) continue
        result.push({ id: c.id, label: c.name, depth })
        const childIds = children.get(id)
        if (childIds) walk(childIds, depth + 1)
      }
    }
    walk(roots, 0)
    return result
  }, [allCats])

  const { data, isLoading, isFetching } = useProductsQuery({
    page: pagination.pageIndex + 1,
    perPage: pagination.pageSize,
    search: debouncedSearch || undefined,
    categoryId: filterCategoryId[0] || undefined,
    status: listStatus,
  })

  const hasActiveFilters = Boolean(search || filterCategoryId.length > 0)
  const clearAllFilters = () => {
    setSearch('')
    setFilterCategoryId([])
    setPagination(p => ({ ...p, pageIndex: 0 }))
  }

  // Reset selection when data changes (e.g., on pagination, search, or refresh)
  useEffect(() => {
    setSelectedIds([])
  }, [data])

  // A page-size change always restarts from page 1 — otherwise the old index
  // points past the last page and the table flashes empty ("per-page broken").
  // The size itself is persisted so it survives remounts.
  const handlePaginationChange = (next: PaginationState) => {
    setPagination((prev) => {
      const sizeChanged = next.pageSize !== prev.pageSize
      if (sizeChanged) {
        try { localStorage.setItem('products-page-size', String(next.pageSize)) } catch { /* ignore */ }
      }
      return sizeChanged ? { pageIndex: 0, pageSize: next.pageSize } : next
    })
  }

  // Handle page count reductions (e.g. after deletion) to avoid getting stuck on an empty page
  const totalPages = data?.meta?.totalPages || 0
  useEffect(() => {
    if (totalPages > 0 && pagination.pageIndex >= totalPages) {
      setPagination((prev) => ({
        ...prev,
        pageIndex: totalPages - 1,
      }))
    } else if (totalPages === 0 && pagination.pageIndex > 0) {
      setPagination((prev) => ({
        ...prev,
        pageIndex: 0,
      }))
    }
  }, [totalPages, pagination.pageIndex])

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
      const d = res.data || res;
      toast.success(`${d.success} product(s) deleted${d.failed ? `, ${d.failed} failed` : ''}`);
      if (d.errors?.length) console.error('Bulk delete errors:', d.errors);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Bulk delete failed'),
  })

  const bulkUpdateMut = useMutation({
    mutationFn: ({ ids, data }: { ids: string[]; data: any }) => productsApi.bulkUpdate(ids, data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setBulkAction(null); setSelectedIds([]);
      const d = res.data || res;
      toast.success(`${d.success} product(s) updated${d.failed ? `, ${d.failed} failed` : ''}`);
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update status'),
  })

  const publishMut = useMutation({
    mutationFn: (row: ProductResponse) => productsApi.publishDraft(row.id, { name: row.name }),
    onSuccess: (res: any, row) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', row.id] })
      toast.success(`"${(res.data || res).name || row.name}" published`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to publish draft'),
  })

  const isBulkPending = bulkDeleteMut.isPending || bulkUpdateMut.isPending

  const handleDuplicate = async (row: ProductResponse) => {
    try {
      const res = await productsApi.get(row.id)
      const source = res.data
      const cleanName = source.name.replace(/^(Copy of\s*)+/, '')
      const copyMatch = source.name.match(/\(copy (\d+)\)$/)
      const copyIndex = copyMatch ? parseInt(copyMatch[1]) + 1 : 2
      const newName = copyIndex > 1 ? `${cleanName} (copy ${copyIndex})` : `Copy of ${cleanName}`
      const newSku = source.sku ? `${source.sku}-CP${Date.now().toString(36).toUpperCase()}` : ''
      setDuplicateSourceRow({
        ...source,
        name: newName,
        slug: `${source.slug}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sku: newSku,
        managedStockQuantity: 0,
      })
      setFormMode('duplicate')
      setFormOpen(true)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to fetch product for duplication')
    }
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <div className='flex items-center gap-2.5'>
              <h2 className='text-2xl font-bold tracking-tight'>Products</h2>
              {isFetching ? (
                <div className='inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary'>
                  <Loader2 className='h-3 w-3 animate-spin' />
                  <span>Refreshing</span>
                </div>
              ) : (
                <div className='inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400'>
                  <span className='size-1.5 rounded-full bg-emerald-500 animate-pulse' />
                  <span>Live</span>
                </div>
              )}
            </div>
            <p className='text-muted-foreground text-xs mt-0.5'>
              <span className='font-semibold text-foreground'>{data?.meta?.total ?? 0}</span> products found
              {selectedIds.length > 0 && <span className='text-primary font-semibold ml-2'>({selectedIds.length} selected)</span>}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-8.5 gap-1.5 rounded-lg border-border/70 hover:bg-surface-raised font-medium shadow-2xs'
              onClick={() => { setAdjustmentProductId(undefined); setAdjustmentModalOpen(true); }}
            >
              <Package className='h-3.5 w-3.5' /> Adjust Stock
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8.5 gap-1.5 rounded-lg border-border/70 hover:bg-surface-raised font-medium shadow-2xs'
              asChild
            >
              <Link to='/op/import-products'><Upload className='h-3.5 w-3.5' /> Import</Link>
            </Button>
            <Button
              size='sm'
              className='h-8.5 gap-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs'
              onClick={() => { setFormMode('add'); setEditRow(undefined); setFormOpen(true); }}
            >
              <Plus className='h-3.5 w-3.5' /> Add Product
            </Button>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Tabs
            value={listStatus}
            onValueChange={(v) => {
              setListStatus(v as 'active' | 'draft')
              setPagination((p) => ({ ...p, pageIndex: 0 }))
            }}
          >
            <TabsList className='h-8 p-0.5 bg-muted/60 dark:bg-muted/30 border border-border/60 rounded-lg'>
              <TabsTrigger value='active' className='h-7 text-xs px-3 rounded-md font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-2xs'>
                Active
              </TabsTrigger>
              <TabsTrigger value='draft' className='h-7 text-xs px-3 rounded-md font-medium gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-2xs'>
                <FileEdit className='h-3 w-3' /> Drafts
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Search & Filters Toolbar */}
        <div className='rounded-xl border border-border/70 bg-card/60 backdrop-blur-md p-2.5 shadow-2xs space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative flex-1 min-w-[260px] max-w-md'>
              <SearchIcon className='absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70' />
              <Input
                ref={searchInputRef}
                placeholder='Search by name, SKU, or variant SKU…'
                aria-label='Search products by name or SKU'
                title='Search by product name, product SKU, or variant SKU'
                value={search}
                onChange={e => setSearch(e.target.value)}
                className='h-8.5 text-xs pl-8.5 pr-14 bg-background/80 focus:bg-background border-border/60 focus:border-primary/50 shadow-2xs transition-colors rounded-lg'
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className='absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors'
                >
                  <X className='h-3.5 w-3.5' />
                </button>
              ) : (
                <kbd className='pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-4.5 select-none items-center gap-1 rounded border border-border/70 bg-muted/60 px-1.5 font-mono text-[9.5px] font-medium text-muted-foreground/80'>
                  ⌘K
                </kbd>
              )}
            </div>

            <div className='w-64'>
              <MultiSearchableSelect
                options={categoryFilterOptions}
                value={filterCategoryId}
                onChange={v => { setFilterCategoryId(v); setPagination(p => ({ ...p, pageIndex: 0 })) }}
                placeholder='Filter by category...'
                searchPlaceholder='Search categories...'
              />
            </div>

            {hasActiveFilters && (
              <Button
                variant='ghost'
                size='sm'
                className='h-8.5 text-xs text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-lg gap-1.5'
                onClick={clearAllFilters}
              >
                <X className='h-3.5 w-3.5' /> Reset
              </Button>
            )}
          </div>

          {hasActiveFilters && (
            <div className='flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/50'>
              <span className='text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider mr-1'>Active:</span>
              {search && (
                <button
                  type='button'
                  onClick={() => setSearch('')}
                  className='inline-flex items-center gap-1.5 rounded-full bg-background/90 text-foreground px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'
                >
                  <span className='text-muted-foreground'>Search:</span>
                  <span className='font-semibold font-mono'>"{search.slice(0, 20)}{search.length > 20 ? '…' : ''}"</span>
                  <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                </button>
              )}
              {filterCategoryId.length > 0 && (() => {
                const opt = categoryFilterOptions.find(o => o.id === filterCategoryId[0])
                return (
                  <button
                    type='button'
                    onClick={() => { setFilterCategoryId([]); setPagination(p => ({ ...p, pageIndex: 0 })) }}
                    className='inline-flex items-center gap-1.5 rounded-full bg-background/90 text-foreground px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'
                  >
                    <span className='text-muted-foreground'>Category:</span>
                    <span className='font-semibold'>{opt?.label || 'Selected'}</span>
                    <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                  </button>
                )
              })()}
            </div>
          )}
        </div>

        {/* Floating Bulk Action Bar */}
        {selectedIds.length > 0 && (
          <div className='fixed bottom-5 left-1/2 -translate-x-1/2 bg-popover/95 dark:bg-card/95 backdrop-blur-md border border-border/80 dark:border-border shadow-2xl rounded-2xl px-3.5 py-2 flex items-center gap-2.5 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200'>
            <Button variant='ghost' size='icon' className='h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground' onClick={() => setSelectedIds([])} disabled={isBulkPending}>
              <X className='h-3.5 w-3.5' />
            </Button>
            <span className='inline-flex items-center rounded-full bg-primary/15 text-primary border border-primary/20 px-2.5 py-0.5 text-xs font-bold whitespace-nowrap shadow-2xs'>
              {selectedIds.length} selected
            </span>
            <div className='h-4 w-px bg-border/60' />
            <Button
              variant='outline'
              size='sm'
              className='h-8 text-xs rounded-lg gap-1.5 border-border/70 shadow-2xs'
              onClick={() => setBulkAction('activate')}
              disabled={isBulkPending}
            >
              <CheckCircle className='h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400' /> Activate
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 text-xs rounded-lg gap-1.5 border-border/70 shadow-2xs'
              onClick={() => setBulkAction('deactivate')}
              disabled={isBulkPending}
            >
              <XCircle className='h-3.5 w-3.5 text-amber-600 dark:text-amber-400' /> Deactivate
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 text-xs rounded-lg gap-1.5 border-border/70 shadow-2xs'
              onClick={() => setPriceLabelModalOpen(true)}
              disabled={isBulkPending}
            >
              <Printer className='h-3.5 w-3.5 text-muted-foreground' /> Price Label
            </Button>
            <div className='h-4 w-px bg-border/60' />
            <Button
              variant='outline'
              size='sm'
              className='h-8 text-xs text-destructive hover:bg-destructive/10 rounded-lg gap-1.5 border-border/70 shadow-2xs'
              onClick={() => setBulkAction('delete')}
              disabled={isBulkPending}
            >
              <Trash2 className='h-3.5 w-3.5' /> Delete
            </Button>
          </div>
        )}

        <ProductsTable
          data={data?.data || []}
          pageCount={data?.meta?.totalPages || 0}
          totalCount={data?.meta?.total || 0}
          pagination={pagination}
          onPaginationChange={handlePaginationChange}
          pageSizeOptions={[10, 20, 30, 50, 100]}
          isLoading={isLoading}
          onEdit={(row) => { setEditRow(row); setFormMode('edit'); setFormOpen(true); }}
          onDelete={(row) => setDeleteTarget(row)}
          onToggleActive={(row, active) => toggleActiveMut.mutate({ id: row.id, isActive: active })}
          onDuplicate={handleDuplicate}
          onPublish={(row) => publishMut.mutate(row)}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      </Main>

      <ProductForm
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) { setDuplicateSourceRow(undefined); } }}
        currentRow={formMode === 'edit' ? editRow : duplicateSourceRow || undefined}
        mode={formMode}
      />

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

      <ManagedStockAdjustmentModal
        open={adjustmentModalOpen}
        onOpenChange={setAdjustmentModalOpen}
        initialProductId={adjustmentProductId}
      />

      <PriceLabelOptionsModal
        open={priceLabelModalOpen}
        onOpenChange={setPriceLabelModalOpen}
        selectedIds={selectedIds}
      />
    </>
  )
}
