import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Package } from 'lucide-react'
import { useInventoryManagement } from '../hooks/use-inventory-management'

interface AdjustStockModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId?: string
  variantId?: string
  variantName?: string
  productName?: string
  availabilityMode?: string
  onSuccess?: () => void
}

export function AdjustStockModal({ open, onOpenChange, productId, variantId, variantName, productName, availabilityMode, onSuccess }: AdjustStockModalProps) {
  const { data: imEnabled = true } = useInventoryManagement()
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [binLocationId, setBinLocationId] = useState('')

  // Fetch product details for variant context
  const { data: productDetail } = useQuery({
    queryKey: ['product-variant-info', productId],
    queryFn: () => apiClient.get(`/products/${productId}`).then(r => r.data),
    enabled: !!productId && !!variantId && !variantName,
  })
  const currentVariant = variantId && productDetail?.variants?.find((v: any) => v.id === variantId)
  const variantLabel = variantName
    ? `${productName || ''} → ${variantName}`
    : currentVariant
      ? `${productName || ''} → ${currentVariant.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || 'Default'} (SKU: ${currentVariant.sku || 'N/A'})`
      : ''

  // Location hierarchy state
  const [zoneId, setZoneId] = useState('')
  const [rackId, setRackId] = useState('')
  const [shelfId, setShelfId] = useState('')

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  // Fetch zones when warehouse changes
  const { data: zones } = useQuery<any[]>({
    queryKey: ['warehouse-zones', warehouseId],
    queryFn: () => apiClient.get(`/warehouses/${warehouseId}/zones`).then(r => r.data || []),
    enabled: !!warehouseId,
  })

  // Fetch racks when zone changes
  const { data: racks } = useQuery<any[]>({
    queryKey: ['warehouse-racks', warehouseId, zoneId],
    queryFn: () => apiClient.get(`/warehouses/${warehouseId}/zones/${zoneId}/racks`).then(r => r.data || []),
    enabled: !!warehouseId && !!zoneId,
  })

  // Fetch shelves when rack changes
  const { data: shelves } = useQuery<any[]>({
    queryKey: ['warehouse-shelves', warehouseId, zoneId, rackId],
    queryFn: () => apiClient.get(`/warehouses/${warehouseId}/zones/${zoneId}/racks/${rackId}/shelves`).then(r => r.data || []),
    enabled: !!warehouseId && !!zoneId && !!rackId,
  })

  // Fetch bins — filtered by hierarchy selections
  const { data: bins } = useQuery<any[]>({
    queryKey: ['warehouse-bins-adjust', warehouseId, zoneId, rackId, shelfId],
    queryFn: () => {
      const params: Record<string, string> = { warehouseId }
      if (zoneId) params.zoneId = zoneId
      if (rackId) params.rackId = rackId
      if (shelfId) params.shelfId = shelfId
      return apiClient.get('/warehouses/bin-locations', { params }).then(r => r.data || r.data?.data || [])
    },
    enabled: !!warehouseId,
  })

  // Reset dependent selections when parent changes
  useEffect(() => {
    if (!warehouseId) {
      setZoneId(''); setRackId(''); setShelfId(''); setBinLocationId('')
    }
  }, [warehouseId])

  useEffect(() => {
    if (!zoneId) {
      setRackId(''); setShelfId(''); setBinLocationId('')
    }
  }, [zoneId])

  useEffect(() => {
    if (!rackId) {
      setShelfId(''); setBinLocationId('')
    }
  }, [rackId])

  useEffect(() => {
    if (!shelfId) {
      setBinLocationId('')
    }
  }, [shelfId])

  const adjustMut = useMutation({
    mutationFn: (data: { productId?: string; variantId?: string; warehouseId: string; quantity: number; reason: string; unitCost?: number; binLocationId?: string }) =>
      apiClient.post('/inventory/physical/adjust', data),
    onSuccess: () => {
      toast.success('Stock adjusted successfully')
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to adjust stock'),
  })

  const handleSave = () => {
    if (!productId) {
      toast.error('No product selected for adjustment')
      return
    }
    const qty = parseInt(quantity)
    if (isNaN(qty) || qty === 0) {
      toast.error('Please enter a valid non-zero quantity')
      return
    }
    const cost = qty > 0 ? parseFloat(unitCost) : undefined
    if (qty > 0 && (isNaN(cost!) || cost! <= 0)) {
      toast.error('Unit Cost (Purchase Price) must be greater than 0 when adding stock')
      return
    }
    if (!reason.trim()) {
      toast.error('Please select or enter a reason')
      return
    }
    adjustMut.mutate({
      productId,
      variantId,
      warehouseId,
      quantity: qty,
      reason,
      unitCost: cost,
      binLocationId: binLocationId && binLocationId !== '__none__' ? binLocationId : undefined,
    })
  }

  const hasZones = zones && zones.length > 0

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        setQuantity(''); setReason(''); setUnitCost(''); setWarehouseId('')
        setZoneId(''); setRackId(''); setShelfId(''); setBinLocationId('')
      }
      onOpenChange(v)
    }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Adjust Stock: {productName || 'Stock'} {variantName ? `(${variantName})` : ''}</DialogTitle>
          {variantLabel && (
            <div className="mt-1.5 rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
              {variantLabel}
            </div>
          )}
        </DialogHeader>
        {imEnabled ? (
          <>
            <div className="grid gap-4 py-4">
              {availabilityMode && availabilityMode !== 'MANAGED_STOCK' && availabilityMode !== 'INVENTORY_CONTROLLED' && (
                <div className='bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2'>
                  <p className='text-xs text-amber-700 dark:text-amber-300'>
                    Availability mode: <strong>{availabilityMode}</strong>. Stock adjustments are not available for this product.
                  </p>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="warehouse">Warehouse</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {(warehouses || []).map((w: any) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Location Hierarchy — only show if warehouse selected and zones exist */}
              {warehouseId && hasZones && (
                <div className="grid gap-2">
                  <Label>Location (optional)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={zoneId} onValueChange={(v) => { setZoneId(v); if (v !== '__none__') { setRackId(''); setShelfId(''); setBinLocationId(''); } }}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Zone (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
                        {(zones || []).map((z: any) => (
                          <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {zoneId && zoneId !== '__none__' && racks && racks.length > 0 && (
                      <Select value={rackId} onValueChange={(v) => { setRackId(v); if (v !== '__none__') { setShelfId(''); setBinLocationId(''); } }}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Rack (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
                          {(racks || []).map((r: any) => (
                            <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {rackId && rackId !== '__none__' && shelves && shelves.length > 0 && (
                      <Select value={shelfId} onValueChange={(v) => { setShelfId(v); if (v !== '__none__') { setBinLocationId(''); } }}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Shelf (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
                          {(shelves || []).map((s: any) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              )}

              {/* Bin Location */}
              {warehouseId && bins && bins.length > 0 && (
                <div className="grid gap-2">
                  <Label>Bin Location (optional)</Label>
                  <Select value={binLocationId} onValueChange={setBinLocationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select bin" />
                    </SelectTrigger>
                    <SelectContent>
                      {(bins || []).map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="quantity">Adjustment Quantity (use - for reduction)</Label>
                <Input
                  id="quantity"
                  type="number"
                  placeholder="e.g. 5 or -2"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              {quantity && !isNaN(Number(quantity)) && (
                <div className="bg-muted/50 p-3 rounded-lg border flex items-center justify-between">
                  <span className="text-sm font-medium">Stock Impact:</span>
                  <span className={`font-bold ${Number(quantity) > 0 ? 'text-green-600' : Number(quantity) < 0 ? 'text-red-600' : ''}`}>
                    {Number(quantity) > 0 ? '+' : ''}{quantity} units
                  </span>
                </div>
              )}

              {parseInt(quantity) > 0 && (
                <div className="grid gap-2">
                  <Label htmlFor="unitCost">Unit Cost / Purchase Price (৳)</Label>
                  <Input
                    id="unitCost"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="e.g. 120.00"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="reason">Adjustment Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="physical_count">Physical Count</SelectItem>
                    <SelectItem value="damage">Damage</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                    <SelectItem value="found">Found</SelectItem>
                    <SelectItem value="correction">Correction</SelectItem>
                    <SelectItem value="initial">Initial Balance</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" onClick={handleSave} disabled={adjustMut.isPending || (availabilityMode != null && availabilityMode !== 'MANAGED_STOCK')}>
                {adjustMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Save Adjustment
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Inventory management is disabled</p>
            <p className="text-xs mt-1">Enable it in system settings to adjust physical stock.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
