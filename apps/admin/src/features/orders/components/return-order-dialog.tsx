import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { rtnApi } from '@/features/orders/api'
import { Button } from '@/components/ui/button'
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

/**
 * Create Return Order (RTN) dialog — the ONLY Partial resolution path.
 * Shows current quantities, return selectors, remaining quantities and a
 * full summary before confirmation. Backend validation remains authoritative.
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
  const rtnMut = useMutation({
    mutationFn: (items: { orderItemId: string; quantity: number }[]) => rtnApi.create(order.id, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      queryClient.invalidateQueries({ queryKey: ['rtn-for-order', order.id] })
      onClose()
      toast.success('Return Order created — original order is now Delivered')
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const items: any[] = order?.items ?? []
  const selected = items.filter((i) => (returnQtys[i.id] ?? 0) > 0)
  const rtnDisplay = order?.displayId
    ? order.displayId.startsWith('ORD-')
      ? `RTN-${order.displayId.slice(4)}`
      : `RTN-${order.displayId}`
    : 'RTN-…'

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <RotateCcw className='h-4 w-4 text-pink-500' /> Create Return Order
          </DialogTitle>
        </DialogHeader>
        {order?.status?.name === 'Partial' && (
          <div className='space-y-4 py-2'>
            <p className='text-xs text-muted-foreground'>
              Select the quantities the customer is returning. The original order is reduced by exactly these
              quantities and becomes <strong>Delivered</strong>; the new Return Order starts at{' '}
              <strong>Return Pending</strong> until the return dispatch is confirmed.
            </p>
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
                          {item.variant?.sku && <span className='text-[10px] text-muted-foreground font-mono'>{item.variant.sku}</span>}
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

            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => onClose()}>Cancel</Button>
              <Button
                disabled={rtnMut.isPending || selected.length === 0}
                onClick={() => {
                  const lines = selected.map((i) => ({ orderItemId: i.id, quantity: returnQtys[i.id] }))
                  rtnMut.mutate(lines)
                }}
              >
                {rtnMut.isPending ? 'Creating…' : 'Create Return Order'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
