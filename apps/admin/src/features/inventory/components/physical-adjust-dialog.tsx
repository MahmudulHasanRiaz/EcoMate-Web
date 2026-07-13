import { useState, useMemo, useEffect } from 'react'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Loader2, Package, X, Trash2, Plus, Info } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  preSelected?: {
    productId: string
    variantId?: string
  }
}

interface AdjustItem {
  id: string // local unique ID for listing
  productId: string
  variantId?: string
  name: string
  sku: string
  image?: string
  quantity: number
  unitCost: string
  binLocationId: string
  baseCost: number // fallback cost from product
}

export function PhysicalAdjustDialog({ open, onOpenChange, preSelected }: Props) {
  const queryClient = useQueryClient()
  const [productSearch, setProductSearch] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [reason, setReason] = useState('')
  const [items, setItems] = useState<AdjustItem[]>([])

  const { data: products } = useQuery<any[]>({
    queryKey: ['product-search-physical-bulk', productSearch],
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

  const { data: binLocations } = useQuery<any[]>({
    queryKey: ['warehouse-bins-bulk', selectedWarehouse],
    queryFn: () => apiClient.get(`/warehouses/${selectedWarehouse}/bin-locations`).then(r => r.data || []),
    enabled: !!selectedWarehouse,
  })

  const bulkAdjustMut = useMutation({
    mutationFn: (data: {
      warehouseId: string
      reason: string
      items: {
        productId: string
        variantId?: string
        quantity: number
        binLocationId?: string
        unitCost?: number
      }[]
    }) => apiClient.post('/inventory/physical/bulk-adjust', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-physical-list'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-history-logs'] })
      queryClient.invalidateQueries({ queryKey: ['physical-reservations'] })
      toast.success('Physical stock adjustments applied successfully')
      reset()
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Adjustment failed'),
  })

  // Flatten products and variants for searchable command list
  const searchOptions = useMemo(() => {
    if (!products) return []
    const options: any[] = []
    for (const p of products) {
      if (p.type === 'simple') {
        const image = p.images?.[0] || p.image
        options.push({
          id: p.id,
          key: `simple-${p.id}`,
          name: p.name,
          sku: p.sku,
          image,
          type: 'simple',
          productId: p.id,
          variantId: undefined,
          cost: parseFloat(p.standardCost || p.basePrice || '0'),
        })
      } else {
        for (const v of p.variants || []) {
          const attrLabel = v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || v.sku
          const image = v.image || p.images?.[0] || p.image
          options.push({
            id: v.id,
            key: `variant-${v.id}`,
            name: `${p.name} (${attrLabel})`,
            sku: v.sku,
            image,
            type: 'variant',
            productId: p.id,
            variantId: v.id,
            cost: parseFloat(v.standardCost || v.price || p.basePrice || '0'),
          })
        }
      }
    }
    return options
  }, [products])

  function reset() {
    setProductSearch('')
    setSelectedWarehouse('')
    setReason('')
    setItems([])
  }

  useEffect(() => {
    if (open && preSelected?.productId) {
      apiClient.get(`/products/${preSelected.productId}`).then(r => {
        const p = r.data
        if (!p) return
        if (preSelected.variantId) {
          const v = p.variants?.find((x: any) => x.id === preSelected.variantId)
          if (v) {
            const attrLabel = v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || v.sku
            addItem({
              productId: p.id,
              variantId: v.id,
              name: `${p.name} (${attrLabel})`,
              sku: v.sku,
              image: v.image || p.images?.[0] || p.image,
              type: 'variant',
              cost: parseFloat(v.standardCost || v.price || p.basePrice || '0'),
            })
          }
        } else {
          addItem({
            productId: p.id,
            variantId: undefined,
            name: p.name,
            sku: p.sku,
            image: p.images?.[0] || p.image,
            type: 'simple',
            cost: parseFloat(p.standardCost || p.basePrice || '0'),
          })
        }
      }).catch(err => {
        console.error('Failed to load preselected product', err)
      })
    }
  }, [open, preSelected])

  function addItem(option: any) {
    // Avoid duplicates in the list
    const exists = items.some(
      (item) => item.productId === option.productId && item.variantId === option.variantId
    )
    if (exists) {
      toast.error('Item is already added to the list')
      return
    }

    const newItem: AdjustItem = {
      id: Math.random().toString(36).slice(2, 9),
      productId: option.productId,
      variantId: option.variantId,
      name: option.name,
      sku: option.sku,
      image: option.image,
      quantity: 1,
      unitCost: option.cost > 0 ? option.cost.toString() : '',
      binLocationId: '',
      baseCost: option.cost,
    }

    setItems((prev) => [...prev, newItem])
    setProductSearch('')
  }

  function updateItem(id: string, fields: Partial<AdjustItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...fields } : item))
    )
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  function handleSubmit() {
    if (!selectedWarehouse) { toast.error('Select a warehouse'); return }
    if (items.length === 0) { toast.error('Add at least one product to adjust'); return }
    if (!reason.trim()) { toast.error('Reason is required'); return }

    const hasPositive = items.some(i => i.quantity > 0);
    const hasNegative = items.some(i => i.quantity < 0);

    if (hasPositive && hasNegative) {
      toast.error('Cannot mix stock additions and deductions in the same request. Please submit positive and negative adjustments separately.');
      return;
    }

    // Validate items
    for (const item of items) {
      if (!item.quantity || item.quantity === 0) {
        toast.error(`Please specify a non-zero quantity for ${item.name}`)
        return
      }
      if (item.quantity > 0) {
        const cost = parseFloat(item.unitCost)
        if (isNaN(cost) || cost <= 0) {
          toast.error(`Unit cost is required and must be greater than 0 for adding stock of ${item.name}`)
          return
        }
        if (!item.binLocationId) {
          toast.error(`Bin Location is required for adding stock of ${item.name}`)
          return
        }
      }
    }

    // Map fields for backend DTO
    bulkAdjustMut.mutate({
      warehouseId: selectedWarehouse,
      reason: reason.trim(),
      items: items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId || undefined,
        quantity: item.quantity,
        binLocationId: item.binLocationId || undefined,
        unitCost: item.quantity > 0 ? parseFloat(item.unitCost) : undefined,
      })),
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className='sm:max-w-[800px] max-h-[90vh] flex flex-col gap-4 overflow-hidden'>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Adjust Physical Stock</DialogTitle>
          <DialogDescription>Create physical inventory adjustments for one or multiple products.</DialogDescription>
        </DialogHeader>

        <div className='flex-1 overflow-y-auto pr-1 space-y-5 py-2'>
          {/* Warehouse and Reason Settings */}
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4 bg-muted/30 p-4 rounded-xl border border-border/60'>
            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>Warehouse</Label>
              <Select value={selectedWarehouse} onValueChange={(v) => { setSelectedWarehouse(v); setItems(prev => prev.map(i => ({ ...i, binLocationId: '' }))) }}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder='Select Warehouse' />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses || []).map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-semibold'>Adjustment Reason</Label>
              <Input
                placeholder='e.g., Annual audit count, damage write-off'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="bg-background"
              />
            </div>
          </div>

          {/* Product Search Input */}
          <div className='space-y-2'>
            <Label className='text-sm font-semibold'>Add Products/Variants</Label>
            <Command className='border rounded-lg shadow-sm' shouldFilter={false}>
              <CommandInput
                placeholder='Search by product name or SKU...'
                value={productSearch}
                onValueChange={setProductSearch}
              />
              {productSearch.length > 0 && (
                <CommandList className='max-h-56 overflow-y-auto'>
                  <CommandEmpty>No products or variants found.</CommandEmpty>
                  <CommandGroup>
                    {searchOptions.map((opt: any) => (
                      <CommandItem
                        key={opt.key}
                        onSelect={() => addItem(opt)}
                        className="cursor-pointer hover:bg-accent/40"
                      >
                        <div className='flex items-center gap-3 w-full'>
                          <div className='w-9 h-9 rounded border bg-muted overflow-hidden flex items-center justify-center flex-shrink-0'>
                            {opt.image ? (
                              <SafeImage src={appUrl(opt.image)} alt='' className='w-full h-full object-cover' />
                            ) : (
                              <Package className='h-5 w-5 text-muted-foreground' />
                            )}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='flex items-center gap-2'>
                              <span className='truncate text-sm font-medium'>{opt.name}</span>
                              {opt.type === 'variant' && (
                                <Badge variant='outline' className='text-[9px] px-1.5 py-0 text-blue-600 border-blue-200 bg-blue-50/50'>Variant</Badge>
                              )}
                            </div>
                            <span className='text-xs text-muted-foreground'>{opt.sku}</span>
                          </div>
                          <Plus className="h-4 w-4 text-muted-foreground ml-auto" />
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              )}
            </Command>
          </div>

          {/* Table of items to adjust */}
          <div className='space-y-2'>
            <Label className='text-sm font-semibold flex items-center gap-1.5'>
              Adjustment Items
              {items.length > 0 && <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs">{items.length}</Badge>}
            </Label>
            {items.length === 0 ? (
              <div className='border-2 border-dashed rounded-xl p-8 text-center text-muted-foreground bg-muted/5 flex flex-col items-center gap-2'>
                <Package className='h-8 w-8 text-muted-foreground/45' />
                <p className='text-sm'>No products selected yet. Use the search bar above to add items.</p>
              </div>
            ) : (
              <div className='rounded-xl border overflow-hidden bg-background'>
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-[40%]">Product / Variant</TableHead>
                      <TableHead className="w-[18%]">Bin Location</TableHead>
                      <TableHead className="w-[17%] text-center">Quantity</TableHead>
                      <TableHead className="w-[20%] text-right">Unit Cost (৳)</TableHead>
                      <TableHead className="w-[5%]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const showBinCost = item.quantity > 0
                      return (
                        <TableRow key={item.id} className="hover:bg-muted/5">
                          <TableCell className="align-middle">
                            <div className='flex items-center gap-2.5 min-w-0'>
                              <div className='w-9 h-9 rounded border bg-muted overflow-hidden flex items-center justify-center flex-shrink-0'>
                                {item.image ? (
                                  <SafeImage src={appUrl(item.image)} alt='' className='w-full h-full object-cover' />
                                ) : (
                                  <Package className='h-5 w-5 text-muted-foreground' />
                                )}
                              </div>
                              <div className='min-w-0'>
                                <span className='font-medium text-sm block truncate' title={item.name}>{item.name}</span>
                                <span className='text-xs text-muted-foreground block truncate'>SKU: {item.sku}</span>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="align-middle">
                            {selectedWarehouse ? (
                              <Select
                                value={item.binLocationId}
                                onValueChange={(v) => updateItem(item.id, { binLocationId: v })}
                              >
                                <SelectTrigger className="h-8 py-0 px-2 text-xs">
                                  <SelectValue placeholder='Auto-assign' />
                                </SelectTrigger>
                                <SelectContent>
                                  {(binLocations || []).map((b: any) => (
                                    <SelectItem key={b.id} value={b.id} className="text-xs">
                                      {b.code}{b.zone ? ` (${b.zone})` : ''}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">Select Wh first</span>
                            )}
                          </TableCell>

                          <TableCell className="align-middle text-center">
                            <Input
                              type='number'
                              placeholder='+10 or -5'
                              value={item.quantity || ''}
                              onChange={(e) => updateItem(item.id, { quantity: parseInt(e.target.value) || 0 })}
                              className="h-8 text-center text-sm w-20 mx-auto"
                            />
                          </TableCell>

                          <TableCell className="align-middle text-right">
                            {showBinCost ? (
                              <div className="flex items-center gap-1 justify-end">
                                <Input
                                  type='number'
                                  step='0.01'
                                  min='0.01'
                                  placeholder='Required'
                                  value={item.unitCost}
                                  onChange={(e) => updateItem(item.id, { unitCost: e.target.value })}
                                  className="h-8 text-right text-sm w-24 border-red-200 focus:border-red-400 focus:ring-red-100"
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not required</span>
                            )}
                          </TableCell>

                          <TableCell className="align-middle text-center">
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-7 w-7 text-muted-foreground hover:text-destructive'
                              onClick={() => removeItem(item.id)}
                            >
                              <Trash2 className='h-3.5 w-3.5' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {items.some(i => i.quantity > 0) && (
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground mt-1 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 p-2.5 rounded-lg">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p>Unit cost is required for items adding positive stock quantities to calculate proper costing/valuation basis (FIFO) in movement histories.</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className='border-t pt-3 flex items-center justify-between sm:justify-end gap-2'>
          <Button variant='outline' onClick={() => { reset(); onOpenChange(false) }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={bulkAdjustMut.isPending || items.length === 0}>
            {bulkAdjustMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
            Apply Adjustments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
