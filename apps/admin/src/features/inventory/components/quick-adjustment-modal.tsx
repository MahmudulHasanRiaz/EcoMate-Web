import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

interface QuickAdjustmentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId?: string
  productName?: string
  availabilityMode?: string
  onSuccess?: () => void
}

export function QuickAdjustmentModal({ open, onOpenChange, productId, productName, availabilityMode, onSuccess }: QuickAdjustmentModalProps) {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [warehouseId, setWarehouseId] = useState('main')
  const [unitCost, setUnitCost] = useState('')

  const adjustMut = useMutation({
    mutationFn: (data: { productId?: string; warehouseId: string; quantity: number; reason: string; unitCost?: number }) =>
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
    adjustMut.mutate({ productId, warehouseId, quantity: qty, reason, unitCost: cost })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setQuantity(''); setReason(''); setUnitCost(''); } onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Quick Adjust: {productName || 'Stock'}</DialogTitle>
        </DialogHeader>
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
                <SelectItem value="main">Main Warehouse</SelectItem>
                <SelectItem value="retail">Retail Store</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
      </DialogContent>
    </Dialog>
  )
}
