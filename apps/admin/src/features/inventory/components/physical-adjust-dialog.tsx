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
import { Loader2, Package, X, Check, ChevronRight, Plus, Trash2 } from 'lucide-react'

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

interface LineItem {
  tempId: string
  productId: string
  productName: string
  productType: string
  productImage?: string
  variantId?: string
  variantLabel?: string
  warehouseId: string
  warehouseName: string
  quantity: number
  reason: string
  unitCost?: number
  binLocationId?: string
}

let tempIdCounter = 0

export function PhysicalAdjustDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()

  // Form state
  const [lineItems, setLineItems] = useState<LineItem[]>([])
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

  const bulkAdjustMut = useMutation({
    mutationFn: (data: { items: LineItem[] }) =>
      apiClient.post('/inventory/physical/bulk-adjust', {
        items: data.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          warehouseId: item.warehouseId,
          quantity: item.quantity,
          reason: item.reason,
          unitCost: item.unitCost,
          binLocationId: item.binLocationId || undefined,
        })),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['inventory-physical-list'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-history-logs'] })
      queryClient.invalidateQueries({ queryKey: ['physical-reservations'] })

      const data = res.data || res
      const adjusted = data.totalAdjusted ?? 0
      const failed = data.totalFailed ?? 0
      if (failed > 0) {
        toast.warning(`${adjusted} adjusted, ${failed} failed — check results`)
      } else {
        toast.success(`${adjusted} items adjusted successfully`)
      }
      resetAll()
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Bulk adjustment failed'),
  })

  function resetAll() {
    setLineItems([])
    clearProductSelection()
    setSelectedWarehouse('')
    setQuantity(0)
    setReason('')
    setUnitCost('')
  }

  function clearProductSelection() {
    setSelectedProduct(null)
    setSelectedVariantId('')
    setProductSearch('')
  }

  const isVariable = selectedProduct?.type === 'variable' && (selectedProduct?.variants?.length ?? 0) > 0
  const selectedVariant = isVariable
    ? selectedProduct?.variants?.find(v => v.id === selectedVariantId)
    : null

  function addLineItem() {
    if (!selectedProduct) { toast.error('Select a product'); return }
    if (isVariable && !selectedVariantId) { toast.error('Select a variant'); return }
    if (!selectedWarehouse) { toast.error('Select a warehouse'); return }
    if (!quantity || quantity === 0) { toast.error('Quantity must be non-zero'); return }

    const cost = quantity > 0 ? parseFloat(unitCost) : undefined
    if (quantity > 0 && (isNaN(cost!) || cost! <= 0)) {
      toast.error('Unit cost is required when adding stock')
      return
    }

    const warehouse = (warehouses || []).find((w: any) => w.id === selectedWarehouse)

    const item: LineItem = {
      tempId: `item_${++tempIdCounter}`,
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      productType: selectedProduct.type,
      productImage: selectedProduct.image || (selectedProduct as any).images?.[0],
      variantId: isVariable ? selectedVariantId : undefined,
      variantLabel: isVariable && selectedVariant
        ? selectedVariant.attributeValues?.map((av: any) => av.attributeValue.value).join(' / ') || selectedVariant.sku
        : undefined,
      warehouseId: selectedWarehouse,
      warehouseName: warehouse?.name || 'Unknown',
      quantity,
      reason: reason.trim() || 'Manual adjustment',
      unitCost: cost,
      binLocationId: selectedBinLocation || undefined,
    }
    setLineItems([...lineItems, item])
    clearProductSelection()
    setSelectedWarehouse('')
    setSelectedBinLocation('')
    setQuantity(0)
    setReason('')
    setUnitCost('')
  }

  function removeLineItem(tempId: string) {
    setLineItems(lineItems.filter((i) => i.tempId !== tempId))
  }

  function handleSubmit() {
    if (lineItems.length === 0) { toast.error('Add at least one line item'); return }
    bulkAdjustMut.mutate({ items: lineItems })
  }

  const totalQty = lineItems.reduce((s, i) => s + i.quantity, 0)

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { resetAll() } onOpenChange(v) }}>
      <DialogContent className='sm:max-w-[700px] max-h-[90vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Package className='h-5 w-5' /> Bulk Physical Stock Adjustment
          </DialogTitle>
          <DialogDescription>
            Add multiple products and variants in a single adjustment. Each line item gets its own quantity, cost, and warehouse.
          </DialogDescription>
        </DialogHeader>

        <div className='flex-1 overflow-y-auto space-y-5 py-2'>
          {/* ── Product Selection ── */}
          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>Add Line Item — Product</Label>
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
                <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={clearProductSelection}>
                  <X className='h-4 w-4' />
                </Button>
              </div>
            ) : (
              <Command className='border rounded-lg shadow-sm' shouldFilter={false}>
                <CommandInput placeholder='Search by product name or SKU...' value={productSearch} onValueChange={setProductSearch} />
                {productSearch.length > 0 && (
                  <CommandList className='max-h-48 overflow-y-auto'>
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
              <Label className='text-sm font-semibold'>Variant</Label>
              <div className='grid grid-cols-1 gap-2 max-h-36 overflow-y-auto'>
                {selectedProduct.variants!.map((v) => {
                  const attrLabel = v.attributeValues?.map((av: any) => av.attributeValue.value).join(' / ') || v.sku
                  const isSelected = selectedVariantId === v.id
                  return (
                    <button
                      key={v.id}
                      type='button'
                      onClick={() => setSelectedVariantId(v.id)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-left text-sm transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                      }`}
                    >
                      <div className='w-8 h-8 rounded-md border bg-white overflow-hidden flex items-center justify-center flex-shrink-0'>
                        {v.image ? (
                          <SafeImage src={appUrl(v.image)} alt='' className='w-full h-full object-cover' />
                        ) : (
                          <Package className='h-4 w-4 text-muted-foreground' />
                        )}
                      </div>
                      <div className='flex-1 min-w-0'>
                        <span className='font-medium block truncate'>{attrLabel}</span>
                        <span className='text-xs text-muted-foreground'>SKU: {v.sku}</span>
                      </div>
                      {isSelected && (
                        <div className='w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0'>
                          <Check className='h-3 w-3 text-white' strokeWidth={3} />
                        </div>
                      )}
                      {!isSelected && <ChevronRight className='h-4 w-4 text-muted-foreground flex-shrink-0' />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Warehouse + Qty + Cost row ── */}
          <div className='grid grid-cols-4 gap-3'>
            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>Warehouse</Label>
              <Select value={selectedWarehouse} onValueChange={(v) => { setSelectedWarehouse(v); setSelectedBinLocation('') }}>
                <SelectTrigger className='h-9 text-xs'>
                  <SelectValue placeholder='Select' />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses || []).map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>Quantity</Label>
              <Input className='h-9 text-xs' type='number' placeholder='+10 or -5' value={quantity || ''} onChange={e => setQuantity(parseInt(e.target.value) || 0)} />
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>Unit Cost (৳)</Label>
              <Input className='h-9 text-xs' type='number' step='0.01' min='0.01' placeholder='e.g. 120' value={unitCost} onChange={e => setUnitCost(e.target.value)} />
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>Bin (opt)</Label>
              <Select value={selectedBinLocation} onValueChange={setSelectedBinLocation}>
                <SelectTrigger className='h-9 text-xs'>
                  <SelectValue placeholder='Auto/Select' />
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
          </div>

          <div className='space-y-1.5'>
            <Label className='text-xs font-semibold'>Reason</Label>
            <Input className='h-9 text-xs' placeholder='e.g. Cycle count correction' value={reason} onChange={e => setReason(e.target.value)} />
          </div>

          <Button
            type='button'
            variant='outline'
            size='sm'
            className='w-full gap-1 text-xs'
            onClick={addLineItem}
            disabled={!selectedProduct}
          >
            <Plus className='h-3.5 w-3.5' /> Add to Adjustment List
          </Button>

          {/* ── Line Items List ── */}
          {lineItems.length > 0 && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label className='text-sm font-semibold'>Line Items ({lineItems.length})</Label>
                <span className='text-xs text-muted-foreground'>Net Qty: {totalQty > 0 ? '+' : ''}{totalQty}</span>
              </div>
              <div className='space-y-2 max-h-48 overflow-y-auto border rounded-lg divide-y'>
                {lineItems.map((item) => (
                  <div key={item.tempId} className='flex items-center gap-3 px-3 py-2 hover:bg-muted/30 text-xs'>
                    <div className='w-8 h-8 shrink-0 rounded border bg-muted overflow-hidden flex items-center justify-center'>
                      {item.productImage ? (
                        <img src={appUrl(item.productImage)} alt='' className='w-full h-full object-cover' />
                      ) : (
                        <Package className='h-4 w-4 text-muted-foreground/50' />
                      )}
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='font-medium truncate'>
                        {item.productName}
                        {item.variantLabel && <span className='text-muted-foreground'> — {item.variantLabel}</span>}
                      </div>
                      <div className='text-[10px] text-muted-foreground'>
                        {item.warehouseName}
                        {item.unitCost ? `  |  ৳${item.unitCost}/unit` : ''}
                      </div>
                    </div>
                    <span className={`font-semibold shrink-0 ${item.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.quantity > 0 ? '+' : ''}{item.quantity}
                    </span>
                    <Button variant='ghost' size='icon' className='h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive' onClick={() => removeLineItem(item.tempId)}>
                      <Trash2 className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className='gap-2 pt-2 border-t'>
          <Button variant='outline' size='sm' onClick={() => { resetAll(); onOpenChange(false) }}>Cancel</Button>
          <Button size='sm' onClick={handleSubmit} disabled={bulkAdjustMut.isPending || lineItems.length === 0}>
            {bulkAdjustMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
            Apply {lineItems.length} Adjustment{lineItems.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
