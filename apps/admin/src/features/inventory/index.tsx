import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, AlertTriangle, Plus, X, Package, Search as SearchIcon } from 'lucide-react'
import { toast } from 'sonner'

const inventoryApi = {
  lowStock: () => apiClient.get('/inventory/low-stock'),
  logs: (q: any) => apiClient.get('/inventory/logs', { params: q }),
  adjust: (data: any) => apiClient.post('/inventory/adjust', data),
}

export function Inventory() {
  const qc = useQueryClient()
  const { data: lowStock, isLoading: lsLoading } = useQuery({ queryKey: ['inventory-low'], queryFn: () => inventoryApi.lowStock().then(r => r.data) })
  const { data: logs, isLoading: logLoading } = useQuery({ queryKey: ['inventory-logs'], queryFn: () => inventoryApi.logs({ page: 1, perPage: 20 }).then(r => r.data) })

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [productName, setProductName] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [quantity, setQuantity] = useState('0')
  const [reason, setReason] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (productSearch.length < 2) { setSearchResults([]); return }
    setSearching(true)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await apiClient.get('/products', { params: { search: productSearch, perPage: 8 } })
        setSearchResults((res.data as any)?.data || [])
      } catch { setSearchResults([]) }
      setSearching(false)
    }, 350)
    return () => clearTimeout(searchTimer.current)
  }, [productSearch])

  const adjustMut = useMutation({
    mutationFn: (data: any) => inventoryApi.adjust(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setAdjustOpen(false); setProductId(''); setProductName(''); setProductSearch(''); setQuantity('0'); setReason(''); toast.success('Stock adjusted'); },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to adjust stock'),
  })

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div><h2 className='text-2xl font-bold tracking-tight'>Inventory</h2><p className='text-muted-foreground text-sm'>Monitor and adjust stock levels.</p></div>
          <Button onClick={() => setAdjustOpen(true)}><Plus className='h-4 w-4 mr-1' /> Adjust Stock</Button>
        </div>

        <Card className='border-orange-200 dark:border-orange-800'>
          <CardHeader className='pb-2'><CardTitle className='text-base flex items-center gap-2'><AlertTriangle className='h-4 w-4 text-orange-500' /> Low Stock Alerts {(lowStock as any)?.count > 0 && <Badge variant='destructive'>{(lowStock as any)?.count}</Badge>}</CardTitle></CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead className='text-right'>Stock</TableHead><TableHead className='text-right'>Alert At</TableHead></TableRow></TableHeader>
              <TableBody>
                {lsLoading ? <TableRow><TableCell colSpan={4} className='text-center'><Loader2 className='animate-spin h-4 w-4 mx-auto' /></TableCell></TableRow> :
                 (lowStock as any)?.products?.length ? (lowStock as any).products.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className='font-medium'>{p.name}</TableCell>
                    <TableCell className='text-muted-foreground text-sm'>{p.sku || '—'}</TableCell>
                    <TableCell className='text-right'><Badge variant='destructive'>{p.stock}</Badge></TableCell>
                    <TableCell className='text-right text-sm text-muted-foreground'>{p.lowStockQty || 5}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={4} className='text-center py-4 text-muted-foreground text-sm'>No low stock alerts</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>Stock Movement Logs</CardTitle></CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Product ID</TableHead><TableHead>Combo ID</TableHead><TableHead className='text-right'>Qty</TableHead><TableHead>Reason</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {logLoading ? <TableRow><TableCell colSpan={6} className='text-center'><Loader2 className='animate-spin h-4 w-4 mx-auto' /></TableCell></TableRow> :
                 (logs as any)?.data?.length ? (logs as any).data.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell><Badge variant='outline'>{l.type}</Badge></TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{l.productId?.slice(0,8) || '—'}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{l.comboId?.slice(0,8) || '—'}</TableCell>
                    <TableCell className='text-right font-medium'><Badge variant={l.quantity > 0 ? 'default' : 'destructive'} className='text-xs'>{l.quantity > 0 ? '+' : ''}{l.quantity}</Badge></TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{l.reason || '—'}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{l.createdAt ? new Date(l.createdAt).toLocaleString() : ''}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={6} className='text-center py-4 text-muted-foreground text-sm'>No logs yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader><DialogTitle>Adjust Stock</DialogTitle></DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>Product</Label>
              {productId ? (
                <div className='flex items-center justify-between bg-muted rounded-md px-3 py-2'>
                  <div className='flex items-center gap-2'>
                    <Package className='h-4 w-4 text-muted-foreground' />
                    <span className='text-sm font-medium'>{productName}</span>
                  </div>
                  <button onClick={() => { setProductId(''); setProductName(''); setProductSearch(''); setSearchResults([]) }} className='text-muted-foreground hover:text-foreground'>
                    <X className='h-4 w-4' />
                  </button>
                </div>
              ) : (
                <div className='relative'>
                  <SearchIcon className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                  <Input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                    placeholder='Search products by name...' className='pl-9' autoFocus />
                  {searchResults.length > 0 && (
                    <div className='absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-auto'>
                      {searchResults.map((p: any) => (
                        <button key={p.id} type='button' className='w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2'
                          onClick={() => { setProductId(p.id); setProductName(p.name); setProductSearch(''); setSearchResults([]) }}>
                          <Package className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
                          <span className='font-medium'>{p.name}</span>
                          <span className='text-xs text-muted-foreground ml-auto'>{p.sku || '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searching && <Loader2 className='absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />}
                </div>
              )}
            </div>
            <div className='space-y-2'>
              <Label>Quantity (positive to add, negative to reduce)</Label>
              <Input type='number' value={quantity} onChange={e => setQuantity(e.target.value)} placeholder='e.g. 10 or -5' />
            </div>
            <div className='space-y-2'>
              <Label>Reason</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder='e.g. Stock count correction' />
            </div>
            <Button className='w-full' disabled={!productId || !quantity || adjustMut.isPending} onClick={() => adjustMut.mutate({ productId, quantity: parseInt(quantity), reason })}>
              {adjustMut.isPending && <Loader2 className='h-4 w-4 mr-1 animate-spin' />}
              Apply Adjustment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
