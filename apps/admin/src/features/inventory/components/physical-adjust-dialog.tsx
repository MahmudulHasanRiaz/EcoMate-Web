import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function PhysicalAdjustDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string; sku: string } | null>(null)
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [reason, setReason] = useState('')

  const { data: products } = useQuery<any[]>({
    queryKey: ['product-search-physical', productSearch],
    queryFn: () => apiClient.get('/products', { params: { search: productSearch, perPage: 8 } }).then(r => r.data?.data || r.data || []),
    enabled: productSearch.length > 0,
  })

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const adjustMut = useMutation({
    mutationFn: (data: { productId: string; warehouseId: string; quantity: number; reason: string }) =>
      apiClient.post('/inventory/physical/adjust', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['physical-stock'] })
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
    setSelectedWarehouse('')
    setQuantity(0)
    setReason('')
  }

  function handleSubmit() {
    if (!selectedProduct) { toast.error('Select a product'); return }
    if (!selectedWarehouse) { toast.error('Select a warehouse'); return }
    if (!quantity || quantity === 0) { toast.error('Quantity must be non-zero'); return }
    if (!reason.trim()) { toast.error('Reason is required'); return }
    adjustMut.mutate({
      productId: selectedProduct.id,
      warehouseId: selectedWarehouse,
      quantity,
      reason: reason.trim(),
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
                      <CommandItem key={p.id} onSelect={() => { setSelectedProduct(p); setProductSearch(p.name) }}>
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
          </div>

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
