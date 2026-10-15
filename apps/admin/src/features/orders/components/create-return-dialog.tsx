import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { returnsApi } from '@/features/returns/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RotateCcw } from 'lucide-react'
import { ReturnItemPicker, pickerLines } from './return-item-picker'
import { remainingByOrderItem } from './return-remaining'

const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  return 'Failed to create the return.'
}

/**
 * The ONE staff return entry (Plus menu → 'Create return').
 *
 * Type selector, Partial by default:
 * - PARTIAL: item picker capped at ordered − already-returned per line.
 * - FULL: confirmation summary — the whole order comes back.
 *
 * Confirm posts ONE POST /returns (source STAFF). Every backend guard
 * rejection (eligibility, overlap, duplicate) surfaces VERBATIM via toast —
 * the dialog never paraphrases money/stock reasons. No staff return is ever
 * created without this modal (the old one-click instant path is gone;
 * courier auto-creation is backend-only and untouched).
 */
export function CreateReturnDialog({
  order,
  open,
  onClose,
}: {
  order: any
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<'PARTIAL' | 'FULL'>('PARTIAL')
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')

  // Active (non-CLOSED) returns for the overlap caps. Display-only: the
  // backend guard is still the authority — this only avoids offering
  // quantities the server would reject.
  const { data: linked } = useQuery({
    queryKey: ['order-returns', order.id],
    queryFn: () => returnsApi.list({ orderId: order.id, limit: 100 }).then((r) => r.data),
    enabled: !!open && !!order?.id,
    staleTime: 15_000,
  })
  const active = useMemo(
    () => (linked ?? []).filter((r: any) => r?.status !== 'CLOSED'),
    [linked],
  )
  const maxQty = useMemo(
    () => remainingByOrderItem(order?.items, active),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order?.items, active],
  )

  const mut = useMutation({
    mutationFn: () => {
      const items =
        kind === 'FULL'
          ? (order?.items ?? [])
              .filter((i: any) => i.productId)
              .map((i: any) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity }))
          : pickerLines(order?.items, qtys)
      return returnsApi.create({
        orderId: order.id,
        type: kind,
        source: 'STAFF',
        items,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
    },
    onSuccess: (ret: any) => {
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      queryClient.invalidateQueries({ queryKey: ['order-returns', order.id] })
      onClose()
      setQtys({})
      setReason('')
      setKind('PARTIAL')
      toast.success(`Return ${ret?.displayId ?? ''} created — stock restores when the return is marked received.`)
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const selected = pickerLines(order?.items, qtys)
  const totalUnits = (order?.items ?? [])
    .filter((i: any) => i.productId)
    .reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0)

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className='max-w-2xl max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <RotateCcw className='h-4 w-4 text-pink-500' /> Create return
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-4 py-2'>
          <div role='radiogroup' aria-label='Return type' className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            {(
              [
                { v: 'PARTIAL', t: 'Partial return', d: 'Only some items come back. Pick the returning quantities below.' },
                { v: 'FULL', t: 'Full return', d: 'The whole order comes back. Confirmed on the next step.' },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type='button'
                role='radio'
                aria-checked={kind === o.v}
                aria-label={o.t}
                onClick={() => setKind(o.v)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  kind === o.v ? 'border-pink-500/60 bg-pink-500/5' : 'border-border hover:bg-muted/40'
                }`}
              >
                <div className='text-sm font-semibold mb-1'>{o.t}</div>
                <p className='text-xs text-muted-foreground leading-relaxed'>{o.d}</p>
              </button>
            ))}
          </div>

          {kind === 'PARTIAL' ? (
            <ReturnItemPicker items={order?.items} value={qtys} onChange={setQtys} maxQty={maxQty} />
          ) : (
            <div className='rounded-lg border border-border p-4 text-sm leading-relaxed'>
              All {totalUnits} item{totalUnits === 1 ? '' : 's'} will be returned. Stock restores
              when the return is marked received — exactly once.
            </div>
          )}

          <div>
            <Label htmlFor='create-return-reason' className='text-xs font-medium text-muted-foreground mb-1 block'>
              Return reason (optional)
            </Label>
            <Textarea
              id='create-return-reason'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder='Customer rejected the items — wrong size'
              className='text-sm resize-none'
            />
          </div>

          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => onClose()}>Cancel</Button>
            <Button
              disabled={mut.isPending || (kind === 'PARTIAL' && selected.length === 0)}
              onClick={() => mut.mutate()}
            >
              {mut.isPending ? 'Creating…' : 'Confirm return'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
