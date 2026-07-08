import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface QuickAdjustmentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productName?: string
}

export function QuickAdjustmentModal({ open, onOpenChange, productName }: QuickAdjustmentModalProps) {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Quick Adjust: {productName || 'Stock'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="warehouse">Warehouse</Label>
            <Select defaultValue="main">
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
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">120</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={`font-bold ${Number(quantity) > 0 ? 'text-green-600' : Number(quantity) < 0 ? 'text-red-600' : ''}`}>
                    {120 + Number(quantity)}
                  </span>
                </div>
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
          <Button type="submit" onClick={() => onOpenChange(false)}>Save Adjustment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
