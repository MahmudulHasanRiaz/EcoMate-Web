import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { returnsApi } from '@/features/returns/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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

const nn = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const fmt = (v: any) => nn(v).toFixed(2)
const round2 = (n: number) => Math.round(n * 100) / 100
const parseAdj = (v: string) => {
  const t = v.trim()
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) ? round2(n) : 0
}

/** One billing row: current → new + explicit signed delta (never ambiguous). */
function MoneyRow({
  label,
  cur,
  next,
  unit = '৳',
  strong = false,
}: {
  label: string
  cur: number
  next: number
  unit?: '৳' | '%'
  strong?: boolean
}) {
  const d = round2(next - cur)
  const view = (v: number) => (unit === '%' ? `${fmt(v)}%` : `৳${fmt(v)}`)
  return (
    <div className='flex items-center justify-between'>
      <span className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className='flex items-center gap-2 font-mono'>
        <span className='text-muted-foreground'>{view(cur)}</span>
        <span aria-hidden>→</span>
        <span className={strong ? 'font-semibold' : 'font-medium'}>{view(next)}</span>
        {d !== 0 && (
          <span className='rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground'>
            {d > 0 ? '+' : '-'}
            {unit === '%' ? `${fmt(Math.abs(d))}%` : `৳${fmt(Math.abs(d))}`}
          </span>
        )}
      </span>
    </div>
  )
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
  const [shippingAdj, setShippingAdj] = useState('')
  const [discountAdj, setDiscountAdj] = useState('')
  const [markDelivered, setMarkDelivered] = useState(true)

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

  const selected = pickerLines(order?.items, qtys)
  const totalUnits = (order?.items ?? [])
    .filter((i: any) => i.productId)
    .reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0)
  const selectedUnits = selected.reduce(
    (s: number, i: any) => s + (Number(i.quantity) || 0),
    0,
  )
  // A PARTIAL selection that consumes every ordered unit is functionally a
  // full return — the backend refuses delivered-marking and closes the order
  // as Returned, so the checkbox is replaced by an explicit note.
  const returnsEverything = kind === 'PARTIAL' && totalUnits > 0 && selectedUnits >= totalUnits

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
        ...(kind === 'PARTIAL' && !returnsEverything
          ? { markOriginalDelivered: markDelivered }
          : {}),
        ...(kind === 'PARTIAL' && shipAdjNum !== 0 ? { shippingAdjustment: shipAdjNum } : {}),
        ...(kind === 'PARTIAL' && discAdjNum !== 0 ? { discountAdjustment: discAdjNum } : {}),
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
      setShippingAdj('')
      setDiscountAdj('')
      setMarkDelivered(true)
      toast.success(`Return ${ret?.displayId ?? ''} created — stock restores when the return is marked received.`)
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  // Signed per-field billing adjustments (PARTIAL only, applied to the
  // ORIGINAL order). The backend is the authority — these live values exist
  // so the admin sees exactly what will bill (and cannot confirm nonsense).
  const shipAdjNum = parseAdj(shippingAdj)
  const discAdjNum = parseAdj(discountAdj)
  const subtotal = nn(order?.subtotal)
  const origShipping = nn(order?.shippingCharge)
  const origDiscount = nn(order?.discount)
  const discountType = order?.discountType === 'percentage' ? 'percentage' : 'flat'
  const origTotal = nn(order?.total)
  const returningSubtotal = (order?.items ?? []).reduce(
    (s: number, i: any) => s + (qtys[i.id] ?? 0) * nn(i.price),
    0,
  )
  const newShipping = round2(origShipping + shipAdjNum)
  const newDiscount = round2(origDiscount + discAdjNum)
  const effectiveDiscount =
    discountType === 'percentage' ? (subtotal * newDiscount) / 100 : newDiscount
  const newTotal = round2(subtotal + newShipping - effectiveDiscount)
  const billingError =
    kind !== 'PARTIAL'
      ? ''
      : newShipping < 0
        ? 'Shipping charge cannot go below 0.'
        : newDiscount < 0
          ? 'Discount cannot go below 0.'
          : newTotal < 0
            ? 'Order total cannot go negative.'
            : ''

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Default-on control: never reopen with a stale "unchecked" from an
        // abandoned attempt (money fields keep their existing close behavior).
        if (!o) setMarkDelivered(true)
        onClose()
      }}
    >
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

          {kind === 'PARTIAL' && (
            <div data-testid='return-billing-card' className='rounded-lg border border-border p-4 space-y-3'>
              <div className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Billing — applied to the original order
              </div>
              <div className='space-y-1.5 text-sm'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground'>Returning items</span>
                  <span className='font-mono font-medium'>৳{fmt(returningSubtotal)}</span>
                </div>
                <MoneyRow label='Shipping charge' cur={origShipping} next={newShipping} />
                <MoneyRow
                  label='Discount'
                  cur={origDiscount}
                  next={newDiscount}
                  unit={discountType === 'percentage' ? '%' : '৳'}
                />
                <MoneyRow label='Order total' cur={origTotal} next={newTotal} strong />
              </div>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <div>
                  <Label htmlFor='return-shipping-adjustment' className='text-xs font-medium text-muted-foreground mb-1 block'>
                    Shipping charge adjustment
                  </Label>
                  <Input
                    id='return-shipping-adjustment'
                    data-testid='return-shipping-adjustment'
                    type='number'
                    step='0.01'
                    value={shippingAdj}
                    onChange={(e) => setShippingAdj(e.target.value)}
                    placeholder='e.g. 50 or -20'
                    className='text-sm'
                  />
                </div>
                <div>
                  <Label htmlFor='return-discount-adjustment' className='text-xs font-medium text-muted-foreground mb-1 block'>
                    Discount adjustment
                  </Label>
                  <Input
                    id='return-discount-adjustment'
                    data-testid='return-discount-adjustment'
                    type='number'
                    step='0.01'
                    value={discountAdj}
                    onChange={(e) => setDiscountAdj(e.target.value)}
                    placeholder='e.g. 50 or -20'
                    className='text-sm'
                  />
                </div>
              </div>
              <p className='text-xs text-muted-foreground leading-relaxed'>
                Positive raises the order's value, negative lowers it — each field independently,
                applied to the original order (not the return).
              </p>
              {billingError && <p className='text-xs font-medium text-red-500'>{billingError}</p>}
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

          {kind === 'PARTIAL' && (
            returnsEverything ? (
              <div
                data-testid='return-covers-all'
                className='rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10'
              >
                <p className='text-sm font-medium text-amber-800 dark:text-amber-300'>
                  This selection returns everything — the order will close as Returned, not Delivered.
                </p>
                <p className='mt-0.5 text-xs text-amber-700/90 dark:text-amber-300/80 leading-relaxed'>
                  No units remain with the customer, so delivered-marking does not apply.
                </p>
              </div>
            ) : (
              <div className='flex items-start gap-2.5 rounded-lg border border-border p-3'>
                <Checkbox
                  id='return-mark-delivered'
                  data-testid='return-mark-delivered'
                  checked={markDelivered}
                  onCheckedChange={(v) => setMarkDelivered(v === true)}
                  className='mt-0.5'
                />
                <div className='space-y-0.5'>
                  <Label htmlFor='return-mark-delivered' className='text-sm font-medium cursor-pointer'>
                    Mark the original order as delivered now
                  </Label>
                  <p className='text-xs text-muted-foreground leading-relaxed'>
                    Uncheck to let courier status updates determine the order status.
                  </p>
                </div>
              </div>
            )
          )}

          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => onClose()}>Cancel</Button>
            <Button
              disabled={mut.isPending || !!(kind === 'PARTIAL' && (selected.length === 0 || billingError))}
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
