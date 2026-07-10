import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { imgUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Loader2, Package } from 'lucide-react'

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
    enabled: productSearch.length > 0,
  })

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const adjustMut = useMutation({
    mutationFn: (data: { productId: string; variantId?: string; warehouseId: string; quantity: number; reason: string; unitCost?: number }) =>
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
    setQuantity(0)
    setReason('')
    setUnitCost('')
  }

  const isVariable = selectedProduct?.type === 'variable' && (selectedProduct?.variants?.length ?? 0) > 0

  const selectedVariant = isVariable
    ? selectedProduct?.variants?.find(v => v.id === selectedVariantId)
    : null

  function handleSubmit() {
    if (!selectedProduct) { toast.error('Select a product'); return }
    if (isVariable && !selectedVariantId) { toast.error('Select a variant'); return }
    if (!selectedWarehouse) { toast.error('Select a warehouse'); return }
    if (!quantity || quantity === 0) { toast.error('Quantity must be non-zero'); return }
    if (!reason.trim()) { toast.error('Reason is required'); return }

    const cost = quantity > 0 ? parseFloat(unitCost) : undefined
    if (quantity > 0 && (isNaN(cost!) || cost! <= 0)) {
      toast.error('Unit Cost must be greater than 0 when adding stock')
      return
    }

    adjustMut.mutate({
      productId: selectedProduct.id,
      variantId: isVariable ? selectedVariantId : undefined,
      warehouseId: selectedWarehouse,
      quantity,
      reason: reason.trim(),
      unitCost: cost,
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>Adjust Physical Stock</DialogTitle>
          <DialogDescription>Add or remove physical inventory at a warehouse.</DialogDescription>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='space-y-2'>
            <Label>Product</Label>
            <Command className='border rounded-md shadow-sm' shouldFilter={false}>
              <CommandInput placeholder='Search products...' value={productSearch} onValueChange={setProductSearch} />
              {productSearch.length > 0 && (
                <CommandList className='max-h-48 overflow-y-auto'>
                  <CommandEmpty>No products found.</CommandEmpty>
                  <CommandGroup>
                    {(products || []).map((p: any) => (
                      <CommandItem key={p.id} onSelect={() => { setSelectedProduct(p); setProductSearch(p.name); setSelectedVariantId('') }}>
                        <div className='flex items-center gap-3 w-full'>
                          <div className='w-10 h-10 rounded border bg-muted overflow-hidden flex items-center justify-center flex-shrink-0'>
                            {p.images?.[0] || p.image ? (
                              <SafeImage src={imgUrl(p.images?.[0] || p.image)} alt='' className='w-full h-full object-cover' />
                            ) : (
                              <Package className='h-5 w-5 text-muted-foreground' />
                            )}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='flex items-center gap-2'>
                              <span className='truncate text-sm font-medium'>{p.name}</span>
                              {p.type === 'variable' && (
                                <span className='text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium flex-shrink-0'>Variable</span>
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
          </div>

          {/* Variant selection for variable products */}
          {isVariable && (
            <div className='space-y-2'>
              <Label>Variant</Label>
              <div className='border rounded-md max-h-40 overflow-y-auto divide-y'>
                {selectedProduct!.variants!.map((v) => {
                  const attrLabel = v.attributeValues?.map((av: any) => av.attributeValue.value).join(' / ') || v.sku
                  return (
                    <button
                      key={v.id}
                      type='button'
                      onClick={() => setSelectedVariantId(v.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                        selectedVariantId === v.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className='w-8 h-8 rounded border bg-muted overflow-hidden flex items-center justify-center flex-shrink-0'>
                        {v.image ? (
                          <SafeImage src={imgUrl(v.image)} alt='' className='w-full h-full object-cover' />
                        ) : (
                          <Package className='h-4 w-4 text-muted-foreground' />
                        )}
                      </div>
                      <div className='flex-1 min-w-0'>
                        <span className='truncate block'>{attrLabel}</span>
                        <span className='text-xs text-muted-foreground'>SKU: {v.sku}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className='space-y-2'>
            <Label>Warehouse</Label>
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
              <SelectTrigger>
                <SelectValue placeholder='Select warehouse' />
              </SelectTrigger>
              <SelectContent>
                {(warehouses || []).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <Label>Quantity (positive=add, negative=remove)</Label>
            <Input type='number' placeholder='e.g. 10 or -5' value={quantity || ''} onChange={e => setQuantity(parseInt(e.target.value) || 0)} />
          </div>

          {quantity > 0 && (
            <div className='space-y-2'>
              <Label>Unit Cost / Purchase Price (৳)</Label>
              <Input type='number' step='0.01' min='0.01' placeholder='e.g. 120.00' value={unitCost} onChange={e => setUnitCost(e.target.value)} />
            </div>
          )}

          {selectedProduct && (
            <div className='bg-muted/30 rounded-md p-3 space-y-1 text-sm'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Product:</span>
                <span className='font-medium text-right max-w-[60%] truncate'>{selectedProduct.name}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Type:</span>
                <span>{isVariable ? 'Variable' : 'Simple'}</span>
              </div>
              {selectedVariant && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Variant:</span>
                  <span className='text-right max-w-[60%] truncate'>
                    {selectedVariant.attributeValues?.map((av: any) => av.attributeValue.value).join(' / ')}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className='space-y-2'>
            <Label>Reason</Label>
            <Input placeholder='e.g. Cycle count correction' value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
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
