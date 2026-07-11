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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Plus, ArrowRight, Truck, Search, Eye, AlertCircle, Loader2, Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Warehouse {
  id: string
  name: string
  location?: string
  isActive: boolean
}

interface TransferLog {
  id: string
  productId: string
  variantId: string | null
  quantity: number
  direction: 'IN' | 'OUT'
  type: string
  stockBefore: number
  stockAfter: number
  note: string | null
  performedBy: string
  performedAt: string
  productName: string
}

interface TransferLogResponse {
  data: TransferLog[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

interface Product {
  id: string
  name: string
  sku: string
}

export function Transfers() {
  const queryClient = useQueryClient()
  const [newTransferOpen, setNewTransferOpen] = useState(false)

  const { data: logsRes, isLoading, isError, error } = useQuery<TransferLogResponse>({
    queryKey: ['inventory-logs', 'transfer'],
    queryFn: () => apiClient.get('/inventory/logs', { params: { type: 'transfer' } }).then(r => r.data),
  })

  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data),
  })

  const logs = logsRes?.data ?? []
  const warehouseList = Array.isArray(warehouses) ? warehouses.filter(w => w.isActive) : []
  const warehouseNameById = (id: string) => warehouseList.find((w: any) => w.id === id)?.name || id

  const [formSource, setFormSource] = useState('')
  const [formDest, setFormDest] = useState('')
  const [formSourceBin, setFormSourceBin] = useState('')
  const [formDestBin, setFormDestBin] = useState('')

  const { data: sourceBins } = useQuery<any[]>({
    queryKey: ['warehouse-bins', formSource],
    queryFn: () => apiClient.get(`/warehouses/${formSource}/bin-locations`).then(r => r.data || []),
    enabled: !!formSource,
  })

  const { data: destBins } = useQuery<any[]>({
    queryKey: ['warehouse-bins', formDest],
    queryFn: () => apiClient.get(`/warehouses/${formDest}/bin-locations`).then(r => r.data || []),
    enabled: !!formDest,
  })

  const [productSearch, setProductSearch] = useState('')
  const [productSearchOpen, setProductSearchOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  const { data: productResults, isFetching: searchingProducts } = useQuery({
    queryKey: ['product-search', productSearch],
    queryFn: () =>
      apiClient
        .get<{ data: Product[] }>('/products', { params: { search: productSearch, perPage: 8 } })
        .then(r => r.data.data ?? r.data),
    enabled: productSearch.length > 0,
  })

  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')

  const createTransferMut = useMutation({
    mutationFn: (data: { productId: string; sourceLocation: string; destinationLocation: string; quantity: number; notes?: string; sourceBinId?: string; destinationBinId?: string }) =>
      apiClient.post('/inventory/transfer', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-logs'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-physical-list'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-history-logs'] })
      setNewTransferOpen(false)
      resetForm()
      toast.success('Transfer created successfully')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating transfer'),
  })

  const resetForm = () => {
    setFormSource('')
    setFormDest('')
    setFormSourceBin('')
    setFormDestBin('')
    setSelectedProduct(null)
    setProductSearch('')
    setQuantity('')
    setNotes('')
  }

  const handleCreateTransfer = () => {
    if (!selectedProduct) { toast.error('Select a product'); return }
    if (!formSource) { toast.error('Select source warehouse'); return }
    if (!formDest) { toast.error('Select destination warehouse'); return }
    if (formSource === formDest) { toast.error('Source and destination must differ'); return }
    if (!quantity || parseInt(quantity) < 1) { toast.error('Enter a valid quantity'); return }
    createTransferMut.mutate({
      productId: selectedProduct.id,
      sourceLocation: formSource,
      destinationLocation: formDest,
      quantity: parseInt(quantity),
      notes: notes || undefined,
      sourceBinId: formSourceBin || undefined,
      destinationBinId: formDestBin || undefined,
    })
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
            <h1 className='text-2xl font-bold tracking-tight'>Stock Transfers</h1>
            <p className='text-muted-foreground'>Move inventory between physical warehouses.</p>
          </div>
          <Button onClick={() => setNewTransferOpen(true)}>
            <Plus className='mr-2 h-4 w-4' /> New Transfer
          </Button>
        </div>

        <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search transfers by ID..." className="pl-9 bg-background" />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="transit">In Transit</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer ID</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Initiated By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="animate-spin h-6 w-6 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-destructive">
                    Failed to load transfers. {(error as any)?.response?.data?.message || (error as Error)?.message || 'Unknown error'}
                  </TableCell>
                </TableRow>
              ) : logs.length ? (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium font-mono text-xs">#{log.id.slice(0, 8)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{log.productName}</span>
                        <Badge variant="outline" className="text-xs">{log.direction === 'IN' ? 'Received' : 'Shipped'}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={log.direction === 'IN' ? 'text-green-600' : 'text-red-600'}>
                        {log.direction === 'IN' ? '+' : '-'}{log.quantity}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.direction === 'IN' ? 'default' : 'secondary'}>
                        {log.direction === 'IN' ? 'Completed' : 'In Transit'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(log.performedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.performedBy}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-2" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    No transfers yet. Create your first transfer.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Main>

      <Dialog open={newTransferOpen} onOpenChange={(v) => { if (!v) { setNewTransferOpen(false); resetForm() } }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> Initiate Stock Transfer
            </DialogTitle>
            <DialogDescription>
              Select source and destination locations to begin transferring physical stock.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source Warehouse</Label>
                <Select value={formSource} onValueChange={(v) => { setFormSource(v); setFormSourceBin('') }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouseList.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formSource && sourceBins && sourceBins.length > 0 && (
                  <Select value={formSourceBin} onValueChange={setFormSourceBin}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Source bin (auto if empty)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Auto (LRU oldest bin)</SelectItem>
                      {sourceBins.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.code}{b.zone ? ` (${b.zone})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Destination Warehouse</Label>
                <Select value={formDest} onValueChange={(v) => { setFormDest(v); setFormDestBin('') }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouseList.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formDest && destBins && destBins.length > 0 && (
                  <Select value={formDestBin} onValueChange={setFormDestBin}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Dest bin (unassigned if empty)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Unassigned</SelectItem>
                      {destBins.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.code}{b.zone ? ` (${b.zone})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Product</Label>
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={productSearchOpen} className="w-full justify-between">
                    {selectedProduct ? selectedProduct.name : 'Search product...'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search products..." value={productSearch} onValueChange={setProductSearch} />
                    <CommandEmpty>{searchingProducts ? 'Searching...' : 'No product found.'}</CommandEmpty>
                    <CommandGroup>
                      {productResults?.map(p => (
                        <CommandItem
                          key={p.id}
                          value={p.id}
                          onSelect={() => {
                            setSelectedProduct(p)
                            setProductSearchOpen(false)
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', selectedProduct?.id === p.id ? 'opacity-100' : 'opacity-0')} />
                          <div>
                            <div>{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.sku}</div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="e.g. 50"
              />
            </div>

            <div className="space-y-2">
              <Label>Reference Note</Label>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Weekly restock for retail"
              />
            </div>

            <div className="space-y-2">
              <Label>Stock Impact Preview</Label>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                {selectedProduct ? (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <div className="font-medium">{selectedProduct.name}</div>
                      <Badge variant="outline">Qty: {quantity || '0'}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">{formSource ? warehouseNameById(formSource) : 'Source'} (Source)</div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ArrowRight className="h-3 w-3 text-red-500" /> <span className="text-red-600">-{quantity || '0'} Units</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">{formDest ? warehouseNameById(formDest) : 'Destination'} (Destination)</div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ArrowRight className="h-3 w-3 text-green-500" /> <span className="text-green-600">+{quantity || '0'} Units</span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Select a product to see stock impact preview.</p>
                )}
                <div className="flex items-start gap-2 mt-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <p>Stock deducted from source immediately, but not available at destination until transfer is <strong>Received</strong>.</p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewTransferOpen(false); resetForm() }}>Cancel</Button>
            <Button onClick={handleCreateTransfer} disabled={createTransferMut.isPending}>
              {createTransferMut.isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
              Confirm & Dispatch Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
