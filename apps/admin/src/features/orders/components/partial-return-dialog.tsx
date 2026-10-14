import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { returnsApi } from '@/features/orders/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Scissors } from 'lucide-react'
import { ReturnItemPicker, pickerLines } from './return-item-picker'

const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  return 'Failed to create the partial return.'
}

/**
 * Plus-menu → 'Create Partial Return Order' (Task 4 Fix 8).
 *
 * NOTE (owner-locked T5 boundary): T5 owns the full staff-partial flow
 * (button on Shipping AND Partial → order Partial, dispatch UNCHANGED).
 * Until that flow ships, this menu entry calls ReturnsService create PARTIAL
 * directly — the Return record is the source of truth either way, so T5 can
 * adopt these rows without migration.
 */
export function PartialReturnDialog({
  order,
  open,
  onClose,
}: {
  order: any
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')

  const mut = useMutation({
    mutationFn: () => {
      const items = pickerLines(order?.items, qtys)
      return returnsApi.create({
        orderId: order.id,
        type: 'PARTIAL',
        source: 'STAFF',
        items,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
    },
    onSuccess: (ret: any) => {
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      onClose()
      setQtys({})
      setReason('')
      toast.success(`Partial return ${ret?.displayId ?? ''} created — staff confirm quantities at receipt.`)
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const selected = pickerLines(order?.items, qtys)

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className='max-w-2xl max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Scissors className='h-4 w-4 text-pink-500' /> Create Partial Return Order
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-4 py-2'>
          <p className='text-xs text-muted-foreground'>
            Select the quantities the customer is returning. A PARTIAL Return record is
            created — no new order, no status change here. The kept part of the order
            is untouched.
          </p>
          <ReturnItemPicker items={order?.items} value={qtys} onChange={setQtys} />
          <div>
            <Label htmlFor='partial-return-reason' className='text-xs font-medium text-muted-foreground mb-1 block'>
              Return reason (applies to all items)
            </Label>
            <Textarea
              id='partial-return-reason'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder='Customer rejected the items — wrong size'
              className='text-sm resize-none'
            />
          </div>
          {selected.length > 0 && (
            <div className='rounded-lg border border-pink-500/30 bg-pink-500/5 p-3 text-xs text-muted-foreground'>
              Returning: {selected.map((l) => `${l.productId} × ${l.quantity}`).join(', ')}
            </div>
          )}
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => onClose()}>Cancel</Button>
            <Button disabled={mut.isPending || selected.length === 0} onClick={() => mut.mutate()}>
              {mut.isPending ? 'Creating…' : 'Create partial return'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
