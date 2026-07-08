import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, X, Package, Search as SearchIcon, LayoutGrid } from 'lucide-react'
import { toast } from 'sonner'

export function ManagedStockAdjustmentModal({ open, onOpenChange, initialProductId, initialVariantId }: { open: boolean, onOpenChange: (open: boolean) => void, initialProductId?: string, initialVariantId?: string }) {
  const qc = useQueryClient()
  const [adjustType, setAdjustType] = useState<'product' | 'combo'>('product')

  const [productId, setProductId] = useState(initialProductId || '')
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
  const [selectedProductAvailability, setSelectedProductAvailability] = useState<string | null>(null)

  const variantOptions = useMemo(() => {
    return (variants || []).map((v: any) => {
      const label = v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || v.sku
      return {
        id: v.id,
        label: `${label} — Stock: ${v.managedStockQuantity} ${v.price ? `| ৳${v.price}` : ''}`,
      }
    })
  }, [variants])

  const [quantity, setQuantity] = useState('0')
  const [reason, setReason] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (open && initialProductId) {
      setProductId(initialProductId)
      if (initialVariantId) {
        setVariantId(initialVariantId)
      }
    }
  }, [open, initialProductId, initialVariantId])

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
    if (!productId) { setVariants([]); setVariantId(''); setSelectedProductAvailability(null); return }
    if (productType === 'variable' || !productName) setLoadingVariants(true)
    apiClient.get(`/products/${productId}`).then(r => {
      const p = r.data as any
      if (!productName) {
        setProductName(p.name)
        setProductType(p.type)
      }
      setVariants(p?.variants || [])
      setSelectedProductAvailability(p?.availabilityMode || null)
      if (p?.variants?.length > 0) setVariantId(p.variants[0].id)
    }).catch(() => { setVariants([]); setSelectedProductAvailability(null) }).finally(() => setLoadingVariants(false))
  }, [productId, productType, productName])

  const adjustMut = useMutation({
    mutationFn: (data: any) => apiClient.post('/inventory/adjust', data),
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ['products'] })
      if (productId) qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['inventory-logs'] })
      resetDialog()
      toast.success('Managed stock adjusted')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to adjust stock'),
  })

  const resetDialog = () => {
    onOpenChange(false)
    if (!initialProductId) {
      setProductId(''); setProductName(''); setProductType(null)
    }
    setProductSearch(''); setSearchResults([])
    setComboId(''); setComboName(''); setComboSearch(''); setComboResults([])
    setVariants([]); setVariantId('')
    setQuantity('0'); setReason(''); setSelectedProductAvailability(null)
  }

  const qtyNum = parseInt(quantity)
  const qtyValid = quantity !== '' && !isNaN(qtyNum) && qtyNum !== 0
  const showAdjustBtn = adjustType === 'combo'
    ? (comboId && qtyValid)
    : (productId && qtyValid && (productType !== 'variable' || variantId))

  const handleAdjust = () => {
    if (selectedProductAvailability && selectedProductAvailability !== 'MANAGED_STOCK') {
      toast.error('Stock adjustments not allowed for this product availability mode')
      return
    }
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetDialog(); else onOpenChange(true) }}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader><DialogTitle>Adjust Managed Stock</DialogTitle></DialogHeader>
        <div className='space-y-4'>
          {!initialProductId && (
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
          )}

          {adjustType === 'product' ? (
            <div className='space-y-2'>
              <Label>Product</Label>
              {productId ? (
                <div className='flex items-center justify-between bg-muted rounded-md px-3 py-2'>
                  <div className='flex items-center gap-2 min-w-0'>
                    <Package className='h-4 w-4 text-muted-foreground shrink-0' />
                    <span className='text-sm font-medium truncate'>{productName || <Loader2 className='h-3 w-3 animate-spin' />}</span>
                    {productType === 'variable' && <Badge variant='secondary' className='text-[10px]'>Variable</Badge>}
                  </div>
                  {!initialProductId && (
                    <button onClick={() => { setProductId(''); setProductName(''); setProductType(null); setProductSearch(''); setSearchResults([]); setVariants([]); setVariantId('') }} className='text-muted-foreground hover:text-foreground shrink-0 ml-2'>
                      <X className='h-4 w-4' />
                    </button>
                  )}
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
                    <SearchableSelect
                      options={variantOptions}
                      value={variantId}
                      onChange={setVariantId}
                      placeholder='Select variant...'
                      searchPlaceholder='Search variants...'
                    />
                  ) : (
                    <p className='text-sm text-muted-foreground'>No variants found for this product.</p>
                  )}
                </div>
              )}
              {productId && selectedProductAvailability && selectedProductAvailability !== 'MANAGED_STOCK' && (
                <div className='bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2'>
                  <p className='text-xs text-amber-700 dark:text-amber-300'>
                    Availability mode: <strong>{selectedProductAvailability}</strong>. Stock adjustments not allowed for this product.
                  </p>
                </div>
              )}
              {productId && selectedProductAvailability === 'MANAGED_STOCK' && (
                <div className='bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                  <p className='text-xs text-blue-700 dark:text-blue-300'>
                    Availability mode: <strong>Managed Stock</strong>. Adjustments will update stock and create a ledger entry.
                  </p>
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
  )
}
