import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Minus, Plus } from 'lucide-react'

/**
 * Simple multi-select over original-order lines (Task 4 Fix 8).
 *
 * NOTE: the legacy ReturnOrderDialog picker is NOT reused here — it is
 * RTN-payload-shaped (orderItemId lines + discount deltas + deliver-now) and
 * hard-gated on Partial status. This picker emits plain
 * {productId, variantId, quantity} lines for the unified Return entity and
 * the PARTIAL exchange returning leg.
 */
export function ReturnItemPicker({
  items,
  value,
  onChange,
  maxQty,
}: {
  items: any[]
  value: Record<string, number>
  onChange: (v: Record<string, number>) => void
  /**
   * Per-order-line caps (ordered − already-returned, see
   * return-remaining.ts). Absent lines fall back to the ordered quantity
   * (legacy behavior).
   */
  maxQty?: Record<string, number>
}) {
  const lines = (items ?? []).filter((i: any) => i.productId)
  if (lines.length === 0) {
    return <p className='text-xs text-muted-foreground py-2'>No returnable lines on this order.</p>
  }
  const capOf = (item: any) => {
    const cap = maxQty?.[item.id]
    return typeof cap === 'number' ? Math.max(0, Math.min(cap, item.quantity)) : item.quantity
  }
  return (
    <div className='rounded-lg border border-border overflow-hidden'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className='text-right w-20'>Current</TableHead>
            <TableHead className='text-center w-36'>Return</TableHead>
            <TableHead className='text-right w-20'>Remaining</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((item: any) => {
            const name = item.product?.name ?? 'Item'
            const qty = value[item.id] ?? 0
            const max = capOf(item)
            const remaining = max - qty
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <span className='text-sm font-medium block'>{name}</span>
                  {(item.variant?.sku || item.product?.sku) && (
                    <span className='text-[10px] text-muted-foreground font-mono'>
                      {item.variant?.sku ?? item.product?.sku}
                    </span>
                  )}
                </TableCell>
                <TableCell className='text-right text-sm'>{item.quantity}</TableCell>
                <TableCell>
                  <div className='flex items-center justify-center gap-1.5'>
                    <Button
                      variant='outline' size='icon' className='h-7 w-7'
                      disabled={qty <= 0}
                      aria-label={`Decrease return quantity for ${name}`}
                      onClick={() => onChange({ ...value, [item.id]: Math.max(0, qty - 1) })}
                    ><Minus className='h-3 w-3' /></Button>
                    <span className={`text-sm w-8 text-center font-medium ${qty > 0 ? 'text-pink-500' : 'text-muted-foreground'}`}>{qty}</span>
                    <Button
                      variant='outline' size='icon' className='h-7 w-7'
                      disabled={qty >= max}
                      aria-label={`Increase return quantity for ${name}`}
                      onClick={() => onChange({ ...value, [item.id]: Math.min(max, qty + 1) })}
                    ><Plus className='h-3 w-3' /></Button>
                  </div>
                </TableCell>
                <TableCell className='text-right text-sm'>{remaining}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** Picker state → Return item lines (drops unselected rows). */
export function pickerLines(items: any[], value: Record<string, number>) {
  return (items ?? [])
    .filter((i: any) => i.productId && (value[i.id] ?? 0) > 0)
    .map((i: any) => ({
      productId: i.productId,
      variantId: i.variantId ?? null,
      quantity: value[i.id],
    }))
}
