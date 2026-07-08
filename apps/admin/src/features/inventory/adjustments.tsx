import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Plus, Search, Eye, Loader2, ChevronLeft, ChevronRight, Package } from 'lucide-react'

interface AdjustmentLog {
  id: string
  productId: string
  variantId: string | null
  quantity: number
  direction: string
  type: string
  stockBefore: number
  stockAfter: number
  note: string | null
  performedBy: string
  performedAt: string
  productName: string
}

interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

interface LogsResponse {
  data: AdjustmentLog[]
  meta: PaginationMeta
}

interface ProductSearchResult {
  id: string
  name: string
  sku: string
  managedStockQuantity?: number
}

interface ProductsResponse {
  data: ProductSearchResult[]
}

export function Adjustments() {
  const queryClient = useQueryClient()
  const [newAdjustmentOpen, setNewAdjustmentOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null)
  const [adjustmentQuantity, setAdjustmentQuantity] = useState(0)
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [adjustmentDirection, setAdjustmentDirection] = useState<'IN' | 'OUT'>('IN')

  const { data: logsData, isLoading, isError } = useQuery<LogsResponse>({
    queryKey: ['inventory-adjustment-logs', page],
    queryFn: () =>
      apiClient.get('/inventory/logs', { params: { type: 'adjustment', page, perPage: 10 } }).then(r => r.data),
  })

  const { data: productsData } = useQuery<ProductsResponse>({
    queryKey: ['product-search-adjustment', productSearch],
    queryFn: () =>
      apiClient.get('/products', { params: { search: productSearch, perPage: 8 } }).then(r => r.data),
    enabled: productSearch.length > 0,
  })

  const createMut = useMutation({
    mutationFn: (data: { productId: string; quantity: number; reason: string }) =>
      apiClient.post('/inventory/adjust', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-adjustment-logs'] })
      setNewAdjustmentOpen(false)
      resetAdjustmentForm()
      toast.success('Adjustment created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating adjustment'),
  })

  function resetAdjustmentForm() {
    setSelectedProduct(null)
    setProductSearch('')
    setAdjustmentQuantity(0)
    setAdjustmentReason('')
    setAdjustmentDirection('IN')
  }

  const logs = logsData?.data ?? []
  const meta = logsData?.meta
  const totalPages = meta?.totalPages ?? 1
  const products = productsData?.data ?? []

  function handleCreateAdjustment() {
    if (!selectedProduct) { toast.error('Select a product'); return }
    if (adjustmentQuantity <= 0) { toast.error('Quantity must be positive'); return }
    if (!adjustmentReason.trim()) { toast.error('Reason is required'); return }
    const quantity = adjustmentDirection === 'OUT' ? -Math.abs(adjustmentQuantity) : Math.abs(adjustmentQuantity)
    createMut.mutate({ productId: selectedProduct.id, quantity, reason: adjustmentReason.trim() })
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Complex Adjustments & Audits</h1>
            <p className='text-muted-foreground'>Manage full physical counts, cycle counts, and bulk adjustments.</p>
          </div>
          <Button onClick={() => setNewAdjustmentOpen(true)}>
            <Plus className='mr-2 h-4 w-4' /> New Adjustment
          </Button>
        </div>

        <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search adjustment ID..." className="pl-9 bg-background" />
          </div>
          <Select defaultValue="all_wh">
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Warehouse" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_wh">All Warehouses</SelectItem>
              <SelectItem value="main">Main Warehouse</SelectItem>
              <SelectItem value="retail">Retail Store</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all_status">
            <SelectTrigger className="w-[150px] bg-background">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_status">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adjustment ID</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Stock Before</TableHead>
                <TableHead>Stock After</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Auditor</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-8'>
                    <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-8 text-destructive'>
                    Failed to load adjustments. Try again.
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-12 text-muted-foreground'>
                    No adjustments found.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">{log.id.slice(0, 8).toUpperCase()}</TableCell>
                    <TableCell>{log.productName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{log.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={log.direction === 'IN' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        {log.direction === 'IN' ? '+' : ''}{log.quantity}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.stockBefore}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.stockAfter}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(log.performedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.performedBy}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-2" /> View Report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {meta && totalPages > 1 && (
          <div className='flex items-center justify-center gap-4'>
            <Button variant='outline' size='sm' onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className='h-4 w-4' />
            </Button>
            <span className='text-sm text-muted-foreground'>
              Page {meta.page} of {totalPages} ({meta.total} total)
            </span>
            <Button variant='outline' size='sm' onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <ChevronRight className='h-4 w-4' />
            </Button>
          </div>
        )}
      </Main>

      <Dialog open={newAdjustmentOpen} onOpenChange={v => { setNewAdjustmentOpen(v); if (!v) resetAdjustmentForm() }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" /> Create Inventory Adjustment
            </DialogTitle>
            <DialogDescription>
              Adjust stock quantity for a product with a reason note.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Search Product</Label>
              <Command className='border rounded-md shadow-sm' shouldFilter={false}>
                <CommandInput
                  placeholder='Search products...'
                  value={productSearch}
                  onValueChange={setProductSearch}
                />
                {productSearch.length > 0 && (
                  <CommandList className='max-h-48 overflow-y-auto'>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup>
                      {products.map((p) => (
                        <CommandItem
                          key={p.id}
                          onSelect={() => {
                            setSelectedProduct(p)
                            setProductSearch(p.name)
                          }}
                        >
                          <div className='flex items-center justify-between w-full'>
                            <span>{p.name}</span>
                            <span className='text-xs text-muted-foreground'>{p.sku}</span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                )}
              </Command>
              {selectedProduct && (
                <p className='text-xs text-muted-foreground'>
                  Selected: {selectedProduct.name} ({selectedProduct.sku})
                  {selectedProduct.managedStockQuantity != null && ` — Stock: ${selectedProduct.managedStockQuantity}`}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={adjustmentDirection} onValueChange={(v: 'IN' | 'OUT') => setAdjustmentDirection(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">Stock In (Add)</SelectItem>
                  <SelectItem value="OUT">Stock Out (Remove)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min={1}
                placeholder="e.g. 10"
                value={adjustmentQuantity || ''}
                onChange={e => setAdjustmentQuantity(parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                placeholder="e.g. Cycle count correction"
                value={adjustmentReason}
                onChange={e => setAdjustmentReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewAdjustmentOpen(false); resetAdjustmentForm() }}>
              Cancel
            </Button>
            <Button onClick={handleCreateAdjustment} disabled={createMut.isPending}>
              {createMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
              Create Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
