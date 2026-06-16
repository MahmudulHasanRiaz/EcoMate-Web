import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, AlertTriangle, Plus, X, Package, Search as SearchIcon, LayoutGrid } from 'lucide-react'
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
  const [adjustType, setAdjustType] = useState<'product' | 'combo'>('product')

  const [productId, setProductId] = useState('')
  const [productName, setProductName] = useState('')
  const [productType, setProductType] = useState<string | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  const [comboId, setComboId] = useState('')
  const [comboName, setComboName] = useState('')
  const [comboSearch, setComboSearch] = useState('')
  const [comboResults, setComboResults] = useState<any[]>([])
  const [comboSearching, setComboSearching] = useState(false)

  const [variants, setVariants] = useState<any[]>([])
  const [variantId, setVariantId] = useState('')
  const [loadingVariants, setLoadingVariants] = useState(false)

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

  useEffect(() => {
    if (comboSearch.length < 2) { setComboResults([]); return }
    setComboSearching(true)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await apiClient.get('/combos', { params: { search: comboSearch, perPage: 8 } })
        setComboResults((res.data as any)?.data || [])
      } catch { setComboResults([]) }
      setComboSearching(false)
    }, 350)
    return () => clearTimeout(searchTimer.current)
  }, [comboSearch])

  useEffect(() => {
    if (!productId || productType !== 'variable') { setVariants([]); setVariantId(''); return }
    setLoadingVariants(true)
    apiClient.get(`/products/${productId}`).then(r => {
      const p = r.data as any
      setVariants(p?.variants || [])
      if (p?.variants?.length > 0) setVariantId(p.variants[0].id)
    }).catch(() => setVariants([])).finally(() => setLoadingVariants(false))
  }, [productId, productType])

  const adjustMut = useMutation({
    mutationFn: (data: any) => inventoryApi.adjust(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-low'] }); qc.invalidateQueries({ queryKey: ['inventory-logs'] }); resetDialog(); toast.success('Stock adjusted'); },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to adjust stock'),
  })

  const resetDialog = () => {
    setAdjustOpen(false)
    setProductId(''); setProductName(''); setProductType(null); setProductSearch(''); setSearchResults([])
    setComboId(''); setComboName(''); setComboSearch(''); setComboResults([])
    setVariants([]); setVariantId('')
    setQuantity('0'); setReason('')
  }

  const qtyNum = parseInt(quantity)
  const qtyValid = quantity !== '' && !isNaN(qtyNum) && qtyNum !== 0
  const showAdjustBtn = adjustType === 'combo'
    ? (comboId && qtyValid)
    : (productId && qtyValid && (productType !== 'variable' || variantId))

  const handleAdjust = () => {
    const qty = parseInt(quantity)
    if (isNaN(qty) || qty === 0) return
    if (!reason.trim()) {
      toast.error('Please provide a reason for the adjustment')
      return
    }
    if (adjustType === 'combo') {
      if (!comboId) return
      adjustMut.mutate({ comboId, quantity: qty, reason })
    } else {
      if (!productId) return
      if (productType === 'variable' && !variantId) { toast.error('Please select a variant'); return }
      adjustMut.mutate({ productId, variantId: productType === 'variable' ? variantId : undefined, quantity: qty, reason })
    }
  }

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
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
                    <TableCell className='font-medium'>
                      {p.name}{p.type === 'variant' ? <span className='text-muted-foreground text-xs ml-1'>({p.variantAttributes || ''})</span> : ''}
                    </TableCell>
                    <TableCell className='text-muted-foreground text-sm'>{p.type === 'variant' ? (p.variantSku || '—') : (p.sku || '—')}</TableCell>
                    <TableCell className='text-right'><Badge variant='destructive'>{p.stock}</Badge></TableCell>
                    <TableCell className='text-right text-sm text-muted-foreground'>{p.lowStockQty || 5}{p.type === 'variant' ? <Badge variant='secondary' className='text-[10px] ml-1'>Variant</Badge> : null}</TableCell>
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
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Product</TableHead><TableHead>Variant/Combo</TableHead><TableHead className='text-right'>Qty</TableHead><TableHead>Reason</TableHead><TableHead>Performer</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {logLoading ? <TableRow><TableCell colSpan={7} className='text-center'><Loader2 className='animate-spin h-4 w-4 mx-auto' /></TableCell></TableRow> :
                 (logs as any)?.data?.length ? (logs as any).data.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell><Badge variant='outline'>{l.type}</Badge></TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{l.productName || l.productId?.slice(0,8) || '—'}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {l.variantName || (l.variantId ? `V:${l.variantId.slice(0,8)}` : l.comboName || (l.comboId ? `C:${l.comboId.slice(0,8)}` : '—'))}
                    </TableCell>
                    <TableCell className='text-right font-medium'><Badge variant={l.quantity > 0 ? 'default' : 'destructive'} className='text-xs'>{l.quantity > 0 ? '+' : ''}{l.quantity}</Badge></TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{l.reason || '—'}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{l.performedBy || 'System'}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{l.createdAt ? new Date(l.createdAt).toLocaleString() : ''}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={7} className='text-center py-4 text-muted-foreground text-sm'>No logs yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>

      <Dialog open={adjustOpen} onOpenChange={(v) => { if (!v) resetDialog(); else setAdjustOpen(true) }}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader><DialogTitle>Adjust Stock</DialogTitle></DialogHeader>
          <div className='space-y-4'>
            <div className='flex rounded-md border p-0.5 bg-muted/20'>
              <button
                type='button'
                className={`flex-1 px-3 py-1.5 text-sm rounded-sm font-medium transition-colors ${adjustType === 'product' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => { setAdjustType('product'); setComboId(''); setComboSearch(''); setComboResults([]) }}
              >
                <Package className='h-3.5 w-3.5 inline mr-1.5' />Product
              </button>
              <button
                type='button'
                className={`flex-1 px-3 py-1.5 text-sm rounded-sm font-medium transition-colors ${adjustType === 'combo' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => { setAdjustType('combo'); setProductId(''); setProductName(''); setProductType(null); setProductSearch(''); setSearchResults([]); setVariants([]); setVariantId('') }}
              >
                <LayoutGrid className='h-3.5 w-3.5 inline mr-1.5' />Combo
              </button>
            </div>

            {adjustType === 'product' ? (
              <div className='space-y-2'>
                <Label>Product</Label>
                {productId ? (
                  <div className='flex items-center justify-between bg-muted rounded-md px-3 py-2'>
                    <div className='flex items-center gap-2 min-w-0'>
                      <Package className='h-4 w-4 text-muted-foreground shrink-0' />
                      <span className='text-sm font-medium truncate'>{productName}</span>
                      {productType === 'variable' && <Badge variant='secondary' className='text-[10px]'>Variable</Badge>}
                    </div>
                    <button onClick={() => { setProductId(''); setProductName(''); setProductType(null); setProductSearch(''); setSearchResults([]); setVariants([]); setVariantId('') }} className='text-muted-foreground hover:text-foreground shrink-0 ml-2'>
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
                            onClick={() => { setProductId(p.id); setProductName(p.name); setProductType(p.type); setProductSearch(''); setSearchResults([]) }}>
                            <Package className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
                            <span className='font-medium'>{p.name}</span>
                            <span className='text-xs text-muted-foreground ml-auto'>
                              {p.type === 'variable' ? 'Variable' : (p.sku || '—')}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searching && <Loader2 className='absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />}
                  </div>
                )}

                {productType === 'variable' && productId && (
                  <div className='space-y-2'>
                    <Label>Variant</Label>
                    {loadingVariants ? (
                      <div className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading variants...</div>
                    ) : variants.length > 0 ? (
                      <select
                        value={variantId}
                        onChange={e => setVariantId(e.target.value)}
                        className='w-full rounded-md border px-3 py-2 text-sm bg-background'
                      >
                        {variants.map((v: any) => {
                          const attrs = v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || v.sku
                          return (
                            <option key={v.id} value={v.id}>
                              {attrs} — Stock: {v.stock} {v.price ? `| ৳${v.price}` : ''}
                            </option>
                          )
                        })}
                      </select>
                    ) : (
                      <p className='text-sm text-muted-foreground'>No variants found for this product.</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className='space-y-2'>
                <Label>Combo</Label>
                {comboId ? (
                  <div className='flex items-center justify-between bg-muted rounded-md px-3 py-2'>
                    <div className='flex items-center gap-2'>
                      <LayoutGrid className='h-4 w-4 text-muted-foreground' />
                      <span className='text-sm font-medium'>{comboName}</span>
                    </div>
                    <button onClick={() => { setComboId(''); setComboName(''); setComboSearch(''); setComboResults([]) }} className='text-muted-foreground hover:text-foreground'>
                      <X className='h-4 w-4' />
                    </button>
                  </div>
                ) : (
                  <div className='relative'>
                    <SearchIcon className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                    <Input value={comboSearch} onChange={e => setComboSearch(e.target.value)}
                      placeholder='Search combos by name...' className='pl-9' autoFocus />
                    {comboResults.length > 0 && (
                      <div className='absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-auto'>
                        {comboResults.map((c: any) => (
                          <button key={c.id} type='button' className='w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2'
                            onClick={() => { setComboId(c.id); setComboName(c.name); setComboSearch(''); setComboResults([]) }}>
                            <LayoutGrid className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
                            <span className='font-medium'>{c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {comboSearching && <Loader2 className='absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />}
                  </div>
                )}
              </div>
            )}

            <div className='space-y-2'>
              <Label>Quantity (positive to add, negative to reduce)</Label>
              <Input type='number' value={quantity} onChange={e => setQuantity(e.target.value)} placeholder='e.g. 10 or -5' />
            </div>
            <div className='space-y-2'>
              <Label>Reason</Label>
              <div className='flex flex-wrap gap-1.5'>
                {['Physical count correction', 'Supplier restock', 'Damaged/Defective', 'Customer return', 'Stock transfer', 'Inventory write-off'].map(preset => (
                  <button
                    key={preset}
                    type='button'
                    className={`text-xs px-2 py-1 rounded-md border transition-colors ${reason === preset ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
                    onClick={() => setReason(reason === preset ? '' : preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder='Or type custom reason...' />
            </div>
            <Button className='w-full' disabled={!showAdjustBtn || adjustMut.isPending} onClick={handleAdjust}>
              {adjustMut.isPending && <Loader2 className='h-4 w-4 mr-1 animate-spin' />}
              Apply Adjustment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
