import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { appUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, X, Package, Check, ChevronRight, Search as SearchIcon } from 'lucide-react'
import { toast } from 'sonner'

export function ManagedStockAdjustmentModal({ open, onOpenChange, initialProductId, initialVariantId }: { open: boolean, onOpenChange: (open: boolean) => void, initialProductId?: string, initialVariantId?: string }) {
  const qc = useQueryClient()

  const [productId, setProductId] = useState(initialProductId || '')
  const [productName, setProductName] = useState('')
  const [productImage, setProductImage] = useState('')
  const [productType, setProductType] = useState<string | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  const [variants, setVariants] = useState<any[]>([])
  const [variantId, setVariantId] = useState('')
  const [loadingVariants, setLoadingVariants] = useState(false)
  const [selectedProductAvailability, setSelectedProductAvailability] = useState<string | null>(null)

  const [quantity, setQuantity] = useState('0')
  const [reason, setReason] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (open && initialProductId) {
      setProductId(initialProductId)
      if (initialVariantId) setVariantId(initialVariantId)
    }
  }, [open, initialProductId, initialVariantId])

  // Product search
  useEffect(() => {
    if (productSearch.length < 2 || productId) { setSearchResults([]); return }
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
  }, [productSearch, productId])

  // Fetch product details when productId changes (for variant selection)
  useEffect(() => {
    if (!productId) { setVariants([]); setVariantId(''); setSelectedProductAvailability(null); return }
    setLoadingVariants(true)
    apiClient.get(`/products/${productId}`).then(r => {
      const p = r.data as any
      if (!productName) {
        setProductName(p.name)
        setProductType(p.type)
        setProductImage(p.images?.[0] || p.image || '')
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
      setProductId(''); setProductName(''); setProductType(null); setProductImage('')
    }
    setProductSearch(''); setSearchResults([])
    setVariants([]); setVariantId('')
    setQuantity('0'); setReason(''); setSelectedProductAvailability(null)
  }

  function clearProduct() {
    setProductId(''); setProductName(''); setProductType(null); setProductImage('')
    setProductSearch(''); setSearchResults([]); setVariants([]); setVariantId('')
  }

  const isVar = productType === 'variable'

  const qtyNum = parseInt(quantity)
  const qtyValid = quantity !== '' && !isNaN(qtyNum) && qtyNum !== 0
  const showAdjustBtn = productId && qtyValid && (!isVar || variantId)

  const handleAdjust = () => {
    if (selectedProductAvailability && selectedProductAvailability !== 'MANAGED_STOCK') {
      toast.error('Stock adjustments not allowed for this product availability mode')
      return
    }
    const qty = parseInt(quantity)
    if (isNaN(qty) || qty === 0) return
    if (!reason.trim()) { toast.error('Please provide a reason for the adjustment'); return }
    if (!productId) return
    if (isVar && !variantId) { toast.error('Please select a variant'); return }
    adjustMut.mutate({ productId, variantId: isVar ? variantId : undefined, quantity: qty, reason: reason.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetDialog(); else onOpenChange(true) }}>
      <DialogContent className='sm:max-w-[540px]'>
        <DialogHeader>
          <DialogTitle>Adjust Managed Stock</DialogTitle>
        </DialogHeader>
        <div className='space-y-5'>

          {/* ── Product ── */}
          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>Product</Label>
            {productId ? (
              <div className='flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg p-3'>
                <div className='w-12 h-12 rounded-lg border bg-white overflow-hidden flex items-center justify-center flex-shrink-0'>
                  {productImage ? (
                    <SafeImage src={appUrl(productImage)} alt='' className='w-full h-full object-cover' />
                  ) : (
                    <Package className='h-6 w-6 text-muted-foreground' />
                  )}
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium truncate'>{productName || <Loader2 className='h-3 w-3 animate-spin inline' />}</span>
                    {isVar && <Badge variant='secondary' className='text-[10px]'>Variable</Badge>}
                  </div>
                </div>
                {!initialProductId && (
                  <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={clearProduct}>
                    <X className='h-4 w-4' />
                  </Button>
                )}
              </div>
            ) : (
              <div className='relative'>
                <SearchIcon className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                <Input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  placeholder='Search products by name or SKU...' className='pl-9' autoFocus />
                {searchResults.length > 0 && (
                  <div className='absolute z-10 mt-1 w-full bg-popover border rounded-lg shadow-md max-h-56 overflow-auto'>
                    {searchResults.map((p: any) => (
                      <button key={p.id} type='button' className='w-full text-left px-3 py-2.5 text-sm hover:bg-muted flex items-center gap-3 border-b last:border-0'
                        onClick={() => { setProductId(p.id); setProductName(p.name); setProductType(p.type); setProductImage(p.images?.[0] || p.image || ''); setProductSearch(''); setSearchResults([]) }}>
                        <div className='w-9 h-9 rounded border bg-muted overflow-hidden flex items-center justify-center flex-shrink-0'>
                          {p.images?.[0] || p.image ? (
                            <SafeImage src={appUrl(p.images?.[0] || p.image)} alt='' className='w-full h-full object-cover' />
                          ) : (
                            <Package className='h-4 w-4 text-muted-foreground' />
                          )}
                        </div>
                        <div className='flex-1 min-w-0'>
                          <div className='flex items-center gap-2'>
                            <span className='font-medium truncate'>{p.name}</span>
                            {p.type === 'variable' && <Badge variant='outline' className='text-[10px] text-blue-600 border-blue-200 bg-blue-50'>Variable</Badge>}
                          </div>
                          <span className='text-xs text-muted-foreground'>{p.sku}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {searching && <Loader2 className='absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />}
              </div>
            )}
          </div>

          {/* ── Variant ── */}
          {isVar && productId && (
            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>Variant {variantId && <span className='text-muted-foreground font-normal'>— selected</span>}</Label>
              {loadingVariants ? (
                <div className='flex items-center gap-2 text-sm text-muted-foreground py-4'><Loader2 className='h-4 w-4 animate-spin' /> Loading variants...</div>
              ) : variants.length > 0 ? (
                <div className='max-h-48 overflow-y-auto space-y-1.5'>
                  {variants.map((v: any) => {
                    const attrLabel = v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || v.sku
                    const isSelected = variantId === v.id
                    return (
                      <button
                        key={v.id}
                        type='button'
                        onClick={() => setVariantId(v.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                        }`}
                      >
                        <div className='w-9 h-9 rounded border bg-white overflow-hidden flex items-center justify-center flex-shrink-0'>
                          {v.image ? (
                            <SafeImage src={appUrl(v.image)} alt='' className='w-full h-full object-cover' />
                          ) : (
                            <Package className='h-4 w-4 text-muted-foreground' />
                          )}
                        </div>
                        <div className='flex-1 min-w-0'>
                          <span className='font-medium block truncate'>{attrLabel}</span>
                          <span className='text-xs text-muted-foreground'>SKU: {v.sku} · Stock: {v.managedStockQuantity}</span>
                        </div>
                        {isSelected ? (
                          <div className='w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0'>
                            <Check className='h-3.5 w-3.5 text-white' strokeWidth={3} />
                          </div>
                        ) : (
                          <ChevronRight className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>No variants found.</p>
              )}
            </div>
          )}

          {/* ── Availability notice ── */}
          {productId && selectedProductAvailability && selectedProductAvailability !== 'MANAGED_STOCK' && (
            <div className='bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-700'>
              Availability mode: <strong>{selectedProductAvailability}</strong>. Adjustments not allowed.
            </div>
          )}

          {/* ── Quantity + Reason ── */}
          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>Quantity (positive=add, negative=remove)</Label>
            <Input type='number' value={quantity} onChange={e => setQuantity(e.target.value)} placeholder='e.g. 10 or -5' />
          </div>

          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>Reason</Label>
            <div className='flex flex-wrap gap-1.5'>
              {['Physical count correction', 'Supplier restock', 'Damaged/Defective', 'Customer return', 'Stock transfer'].map(preset => (
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
