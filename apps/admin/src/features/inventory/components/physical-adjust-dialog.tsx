import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { appUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { Loader2, Package, X, Check, ChevronRight } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

interface ProductVariant {
  id: string
  sku: string
  price: number | string
  image?: string | null
  attributeValues: { attributeValue: { id: string; value: string; attribute: { id: string; name: string } } }[]
}

export function PhysicalAdjustDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string; sku: string; type: string; image?: string; variants?: ProductVariant[] } | null>(null)
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [selectedBinLocation, setSelectedBinLocation] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [reason, setReason] = useState('')
  const [unitCost, setUnitCost] = useState('')

  const { data: products } = useQuery<any[]>({
    queryKey: ['product-search-physical', productSearch],
    queryFn: () => apiClient.get('/products', { params: { search: productSearch, perPage: 8 } }).then(r => {
      const raw = r.data?.data || r.data || []
      return raw.map((p: any) => ({
        ...p,
        variants: p.variants?.filter((v: any) => v.isActive !== false) || [],
      }))
    }),
    enabled: productSearch.length > 0 && !selectedProduct,
  })

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const { data: binLocations } = useQuery<any[]>({
    queryKey: ['warehouse-bins', selectedWarehouse],
    queryFn: () => apiClient.get(`/warehouses/${selectedWarehouse}/bin-locations`).then(r => r.data || []),
    enabled: !!selectedWarehouse,
  })

  const adjustMut = useMutation({
    mutationFn: (data: { productId: string; variantId?: string; warehouseId: string; quantity: number; reason: string; unitCost?: number; binLocationId?: string }) =>
      apiClient.post('/inventory/physical/adjust', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-physical-list'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-history-logs'] })
      queryClient.invalidateQueries({ queryKey: ['physical-reservations'] })
      toast.success('Physical stock adjusted')
      reset()
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Adjustment failed'),
  })

  function reset() {
    setProductSearch('')
    setSelectedProduct(null)
    setSelectedVariantId('')
    setSelectedWarehouse('')
    setSelectedBinLocation('')
    setQuantity(0)
    setReason('')
    setUnitCost('')
  }

  const isVariable = selectedProduct?.type === 'variable' && (selectedProduct?.variants?.length ?? 0) > 0

  const selectedVariant = isVariable
    ? selectedProduct?.variants?.find(v => v.id === selectedVariantId)
    : null

  function clearProduct() {
    setSelectedProduct(null)
    setSelectedVariantId('')
    setProductSearch('')
  }

  function handleSubmit() {
    if (!selectedProduct) { toast.error('Select a product'); return }
    if (isVariable && !selectedVariantId) { toast.error('Select a variant'); return }
    if (!selectedWarehouse) { toast.error('Select a warehouse'); return }
    if (!quantity || quantity === 0) { toast.error('Quantity must be non-zero'); return }
    if (!reason.trim()) { toast.error('Reason is required'); return }

    const cost = quantity > 0 ? parseFloat(unitCost) : undefined
    if (quantity > 0 && (isNaN(cost!) || cost! <= 0)) {
      toast.error('Unit cost is required when adding stock')
      return
    }

    adjustMut.mutate({
      productId: selectedProduct.id,
      variantId: isVariable ? selectedVariantId : undefined,
      warehouseId: selectedWarehouse,
      quantity,
      reason: reason.trim(),
      unitCost: cost,
      binLocationId: selectedBinLocation || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className='sm:max-w-[600px]'>
        <DialogHeader>
          <DialogTitle>Adjust Physical Stock</DialogTitle>
          <DialogDescription>Add or remove physical inventory at a warehouse.</DialogDescription>
        </DialogHeader>

        <div className='grid gap-5 py-2'>
          {/* ── Product Selection ── */}
          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>Product</Label>
            {selectedProduct ? (
              <div className='flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg p-3'>
                <div className='w-12 h-12 rounded-lg border bg-white overflow-hidden flex items-center justify-center flex-shrink-0'>
                  {selectedProduct.image || (selectedProduct as any).images?.[0] ? (
                    <SafeImage src={appUrl(selectedProduct.image || (selectedProduct as any).images?.[0])} alt='' className='w-full h-full object-cover' />
                  ) : (
                    <Package className='h-6 w-6 text-muted-foreground' />
                  )}
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium truncate'>{selectedProduct.name}</span>
                    {selectedProduct.type === 'variable' && (
                      <Badge variant='secondary' className='text-[10px] px-1.5 py-0'>Variable</Badge>
                    )}
                  </div>
                  <span className='text-xs text-muted-foreground'>SKU: {selectedProduct.sku}</span>
                </div>
                <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={clearProduct}>
                  <X className='h-4 w-4' />
                </Button>
              </div>
            ) : (
              <Command className='border rounded-lg shadow-sm' shouldFilter={false}>
                <CommandInput placeholder='Search by product name or SKU...' value={productSearch} onValueChange={setProductSearch} />
                {productSearch.length > 0 && (
                  <CommandList className='max-h-56 overflow-y-auto'>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup>
                      {(products || []).map((p: any) => (
                        <CommandItem key={p.id} onSelect={() => { setSelectedProduct(p); setProductSearch(''); setSelectedVariantId('') }}>
                          <div className='flex items-center gap-3 w-full'>
                            <div className='w-10 h-10 rounded border bg-muted overflow-hidden flex items-center justify-center flex-shrink-0'>
                              {p.images?.[0] || p.image ? (
                                <SafeImage src={appUrl(p.images?.[0] || p.image)} alt='' className='w-full h-full object-cover' />
                              ) : (
                                <Package className='h-5 w-5 text-muted-foreground' />
                              )}
                            </div>
                            <div className='flex-1 min-w-0'>
                              <div className='flex items-center gap-2'>
                                <span className='truncate text-sm font-medium'>{p.name}</span>
                                {p.type === 'variable' && (
                                  <Badge variant='outline' className='text-[10px] px-1.5 py-0 text-blue-600 border-blue-200 bg-blue-50'>Variable</Badge>
                                )}
                              </div>
                              <span className='text-xs text-muted-foreground'>{p.sku}</span>
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                )}
              </Command>
            )}
          </div>

          {/* ── Variant Selection ── */}
          {isVariable && selectedProduct && (
            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>Variant {selectedVariantId && <span className='text-muted-foreground font-normal'>— selected</span>}</Label>
              <div className='grid grid-cols-1 gap-2 max-h-48 overflow-y-auto'>
                {selectedProduct.variants!.map((v) => {
                  const attrLabel = v.attributeValues?.map((av: any) => av.attributeValue.value).join(' / ') || v.sku
                  const isSelected = selectedVariantId === v.id
                  return (
                    <button
                      key={v.id}
                      type='button'
                      onClick={() => setSelectedVariantId(v.id)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                      }`}
                    >
                      <div className='w-10 h-10 rounded-md border bg-white overflow-hidden flex items-center justify-center flex-shrink-0'>
                        {v.image ? (
                          <SafeImage src={appUrl(v.image)} alt='' className='w-full h-full object-cover' />
                        ) : (
                          <Package className='h-5 w-5 text-muted-foreground' />
                        )}
                      </div>
                      <div className='flex-1 min-w-0'>
                        <span className='font-medium block truncate'>{attrLabel}</span>
                        <span className='text-xs text-muted-foreground'>SKU: {v.sku}</span>
                      </div>
                      {isSelected && (
                        <div className='w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0'>
                          <Check className='h-3.5 w-3.5 text-white' strokeWidth={3} />
                        </div>
                      )}
                      {!isSelected && <ChevronRight className='h-4 w-4 text-muted-foreground flex-shrink-0' />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Warehouse + Quantity row ── */}
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>Warehouse</Label>
              <Select value={selectedWarehouse} onValueChange={(v) => { setSelectedWarehouse(v); setSelectedBinLocation('') }}>
                <SelectTrigger>
                  <SelectValue placeholder='Select' />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses || []).map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>Quantity</Label>
              <Input type='number' placeholder='+10 or -5' value={quantity || ''} onChange={e => setQuantity(parseInt(e.target.value) || 0)} />
              <p className='text-xs text-muted-foreground'>Positive = add, negative = remove</p>
            </div>
          </div>

          {/* ── Bin Location ── */}
          {selectedWarehouse && quantity > 0 && (
            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>
                Bin Location <span className='text-muted-foreground font-normal text-xs'>(optional)</span>
              </Label>
              <Select value={selectedBinLocation} onValueChange={setSelectedBinLocation}>
                <SelectTrigger>
                  <SelectValue placeholder='Auto-assign or select bin' />
                </SelectTrigger>
                <SelectContent>
                  {(binLocations || []).map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code}{b.zone ? ` (${b.zone})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ── Unit Cost ── */}
          {quantity > 0 && (
            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>
                Unit Cost (৳) <span className='text-red-500 font-normal text-xs'>*required</span>
              </Label>
              <Input type='number' step='0.01' min='0.01' placeholder='e.g. 120.00' value={unitCost} onChange={e => setUnitCost(e.target.value)} />
            </div>
          )}

          {/* ── Reason ── */}
          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>Reason</Label>
            <Input placeholder='e.g. Cycle count correction, purchase received' value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>

        <DialogFooter className='gap-2'>
          <Button variant='outline' onClick={() => { reset(); onOpenChange(false) }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={adjustMut.isPending}>
            {adjustMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
