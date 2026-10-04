import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rtnApi } from '@/features/orders/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RotateCcw, Minus, Plus } from 'lucide-react'

const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  return 'Failed to create the Return Order.'
}

const nn = (v: number | string) => Number(v) || 0
const money = (v: number) => v.toFixed(2)

/**
 * Create Return Order (RTN) dialog — the ONLY Partial resolution path.
 *
 * Three things beyond the item picker (requirements §1–§5):
 *  - ONE overall reason for the whole return; no per-item reasons.
 *  - Optional adjustment of the ORIGINAL's discount / shipping. Defaults to
 *    the current values, so opening the dialog and confirming without
 *    touching anything behaves exactly as before. The Return Order itself
 *    never carries these amounts — they stay on the original only.
 *  - The "is the remaining quantity delivered?" choice.
 */
export function ReturnOrderDialog({
  order,
  open,
  onClose,
}: {
  order: any
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  // Pre-filled with the original's current values; the user may change them.
  const [discount, setDiscount] = useState(String(order?.discount ?? ''))
  const [discountType, setDiscountType] = useState<'flat' | 'percentage'>(order?.discountType === 'percentage' ? 'percentage' : 'flat')
  const [shipping, setShipping] = useState(String(order?.shippingCharge ?? ''))
  const [deliverNow, setDeliverNow] = useState(true)

  const rtnMut = useMutation({
    mutationFn: (payload: {
      items: { orderItemId: string; quantity: number }[]
      reason?: string
      adjustOriginalDiscount?: number
      adjustOriginalDiscountType?: 'flat' | 'percentage'
      adjustOriginalShippingCharge?: number
      deliverRemainingImmediately: boolean
    }) => rtnApi.create(order.id, payload.items, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      queryClient.invalidateQueries({ queryKey: ['rtn-for-order', order.id] })
      queryClient.invalidateQueries({ queryKey: ['rtn-all-for-order', order.id] })
      onClose()
      toast.success(
        deliverNow
          ? 'Return Order created — original order is now Delivered'
          : 'Return Order created — remaining items stay Partial',
      )
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const items: any[] = order?.items ?? []
  const selected = items.filter((i) => (returnQtys[i.id] ?? 0) > 0)

  // Live preview of the ORIGINAL's new bill once the returned lines are removed.
  const originalPreview = useMemo(() => {
    const subtotal = items.reduce((sum, i) => {
      const remaining = i.quantity - (returnQtys[i.id] ?? 0)
      return remaining > 0 ? sum + nn(i.price) * remaining : sum
    }, 0)
    const ship = parseFloat(shipping) || 0
    const rawDiscount = parseFloat(discount) || 0
    const disc = discountType === 'percentage' ? (subtotal * Math.min(100, rawDiscount)) / 100 : rawDiscount
    return { subtotal, shipping: ship, discount: disc, total: Math.max(0, subtotal + ship - disc) }
  }, [items, returnQtys, shipping, discount, discountType])

  const rtnDisplay = order?.displayId
    ? order.displayId.startsWith('ORD-')
      ? `RTN-${order.displayId.slice(4)}`
      : `RTN-${order.displayId}`
    : 'RTN-…'

  const submit = () => {
    const lines = selected.map((i) => ({ orderItemId: i.id, quantity: returnQtys[i.id] }))
    rtnMut.mutate({
      items: lines,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      adjustOriginalDiscount: parseFloat(discount) || 0,
      adjustOriginalDiscountType: discountType,
      adjustOriginalShippingCharge: parseFloat(shipping) || 0,
      deliverRemainingImmediately: deliverNow,
    })
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className='max-w-2xl max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <RotateCcw className='h-4 w-4 text-pink-500' /> Create Return Order
          </DialogTitle>
        </DialogHeader>
        {order?.status?.name === 'Partial' ? (
          <div className='space-y-4 py-2'>
            <p className='text-xs text-muted-foreground'>
              Select the quantities the customer is returning. Those quantities move to a new Return
              Order and are removed from this one. The original's discount and delivery charge can
              be adjusted below if the smaller bill no longer warrants them.
            </p>

            {/* ── Items ── */}
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
                  {items.map((item) => {
                    const qty = returnQtys[item.id] ?? 0
                    const remaining = item.quantity - qty
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className='text-sm font-medium block'>{item.product?.name ?? 'Item'}</span>
                          {item.variant?.sku && (
                            <span className='text-[10px] text-muted-foreground font-mono'>{item.variant.sku}</span>
                          )}
                        </TableCell>
                        <TableCell className='text-right text-sm'>{item.quantity}</TableCell>
                        <TableCell>
                          <div className='flex items-center justify-center gap-1.5'>
                            <Button
                              variant='outline' size='icon' className='h-7 w-7'
                              disabled={qty <= 0}
                              aria-label={`Decrease return quantity for ${item.product?.name ?? 'item'}`}
                              onClick={() => setReturnQtys((q) => ({ ...q, [item.id]: Math.max(0, qty - 1) }))}
                            ><Minus className='h-3 w-3' /></Button>
                            <span className={`text-sm w-8 text-center font-medium ${qty > 0 ? 'text-pink-500' : 'text-muted-foreground'}`}>{qty}</span>
                            <Button
                              variant='outline' size='icon' className='h-7 w-7'
                              disabled={qty >= item.quantity}
                              aria-label={`Increase return quantity for ${item.product?.name ?? 'item'}`}
                              onClick={() => setReturnQtys((q) => ({ ...q, [item.id]: Math.min(item.quantity, qty + 1) }))}
                            ><Plus className='h-3 w-3' /></Button>
                          </div>
                        </TableCell>
                        <TableCell className={`text-right text-sm ${remaining === 0 ? 'text-muted-foreground' : ''}`}>{remaining}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* ── Reason (one, overall) ── */}
            <div>
              <Label htmlFor='rtn-reason' className='text-xs font-medium text-muted-foreground mb-1 block'>
                Return reason (applies to all items)
              </Label>
              <Textarea
                id='rtn-reason'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder='Customer rejected the items — wrong size'
                className='text-sm resize-none'
              />
            </div>

            {/* ── Original financial adjustment ── */}
            <div className='rounded-lg border border-border p-3.5 space-y-3'>
              <div className='text-xs font-semibold text-foreground'>
                Adjust the original order&rsquo;s discount &amp; delivery charge
              </div>
              <p className='text-[11px] text-muted-foreground -mt-1.5'>
                Because items are being removed, the original&rsquo;s bill shrinks. Lower the discount
                    if it no longer applies. These amounts stay on the original — the Return Order
                    carries product lines only.
              </p>
              <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
                <div>
                  <Label htmlFor='rtn-adjust-discount' className='text-xs text-muted-foreground mb-1 block'>Discount (৳)</Label>
                  <div className='flex gap-1.5'>
                    <Input
                      id='rtn-adjust-discount'
                      type='number' min='0' step='0.01'
                      value={discount === '0' ? '' : discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      placeholder='0'
                      className='h-9 text-sm'
                    />
                    <div className='flex border rounded-lg p-0.5 bg-muted/40 shrink-0'>
                      <Button
                        type='button' size='sm' variant={discountType === 'flat' ? 'default' : 'ghost'}
                        className='h-7 px-2 text-xs'
                        onClick={() => setDiscountType('flat')}
                      >Flat</Button>
                      <Button
                        type='button' size='sm' variant={discountType === 'percentage' ? 'default' : 'ghost'}
                        className='h-7 px-2 text-xs'
                        onClick={() => setDiscountType('percentage')}
                      >%</Button>
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor='rtn-adjust-shipping' className='text-xs text-muted-foreground mb-1 block'>Delivery charge (৳)</Label>
                  <Input
                    id='rtn-adjust-shipping'
                    type='number' min='0' step='0.01'
                    value={shipping === '0' ? '' : shipping}
                    onChange={(e) => setShipping(e.target.value)}
                    placeholder='0'
                    className='h-9 text-sm'
                  />
                </div>
                <div className='flex flex-col justify-end'>
                  <div className='text-[11px] text-muted-foreground leading-relaxed'>
                    Original after return:
                    <div className='font-semibold text-foreground text-sm'>৳{money(originalPreview.total)}</div>
                    <div className='text-[10px]'>
                      subtotal ৳{money(originalPreview.subtotal)} − discount ৳{money(originalPreview.discount)} + shipping ৳{money(originalPreview.shipping)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {selected.length > 0 && (
              <div className='rounded-lg border border-pink-500/30 bg-pink-500/5 p-3 space-y-1.5'>
                <div className='text-xs font-semibold'>Returning:</div>
                {selected.map((i) => (
                  <div key={i.id} className='text-xs text-muted-foreground flex justify-between'>
                    <span>{i.product?.name ?? 'Item'}{i.variant?.sku ? ` (${i.variant.sku})` : ''}</span>
                    <span className='font-medium text-foreground'>× {returnQtys[i.id]}</span>
                  </div>
                ))}
                <div className='border-t border-pink-500/20 pt-1.5 text-xs text-muted-foreground'>
                  Original order after return:{' '}
                  {items.map((i) => `${i.product?.name ?? 'Item'} × ${i.quantity - (returnQtys[i.id] ?? 0)}`).join(', ')}
                </div>
                <div className='text-xs'>
                  New return order: <span className='font-mono font-semibold text-pink-500'>{rtnDisplay}</span>
                </div>
              </div>
            )}

            {/* ── Delivered prompt ── */}
            <label htmlFor='rtn-deliver-now' className='flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-border p-3 hover:bg-muted/40'>
              <input
                id='rtn-deliver-now'
                type='checkbox'
                checked={deliverNow}
                onChange={(e) => setDeliverNow(e.target.checked)}
                className='h-4 w-4 mt-0.5 rounded border-border text-primary focus:ring-primary/20'
              />
              <span className='text-xs text-muted-foreground leading-relaxed'>
                <span className='font-semibold text-foreground block'>
                  Is the remaining original order delivered?
                </span>
                {deliverNow
                  ? 'Yes — the remaining items are marked Delivered now.'
                  : 'No — the remaining items stay Partial and the courier will update them on delivery.'}
              </span>
            </label>

            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => onClose()}>Cancel</Button>
              <Button
                disabled={rtnMut.isPending || selected.length === 0}
                onClick={submit}
              >
                {rtnMut.isPending ? 'Creating…' : 'Create Return Order'}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}