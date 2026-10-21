import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { refundsApi } from '@/features/refunds/api'
import { gatewayApi } from '@/features/gateways/api'
import { useAuthStore } from '@/stores/auth-store'

export const REFUND_CANCEL_QUESTION = 'Should this order be cancelled too?'

/**
 * Why the refund option is unavailable for THIS user (null = available).
 *
 * Only the SETTING is enforced client-side: when an admin switches "Staff can
 * process refunds" off, the staff member sees the option greyed out with the
 * reason instead of a silent 403. The permission level itself stays the
 * backend's business (RefundPermissionGuard) — the UI never guesses it from a
 * possibly stale permission list.
 */
export function refundUnavailableReason(opts: {
  role?: string
  staffRefundsAllowed: boolean
}): string | null {
  const role = (opts.role ?? '').toLowerCase()
  if (role === 'admin' || role === 'superadmin') return null
  if (!opts.staffRefundsAllowed) {
    return 'Refunds are restricted to administrators — ask an admin to record this refund. ' +
      'You can still cancel the order without a refund record.'
  }
  return null
}

export interface RefundSourceContext {
  id: string
  gatewayCode: string
  amount: number
  remainder: number
}

/**
 * Record a refund (D5). Writes a Refund row + a negative ledger row; with
 * cancelToo the same transaction also cancels the order atomically (a partial
 * amount is rejected server-side — the cancel gate would still block).
 *
 * D-B: also usable from the payment ledger — pass `initialAmount` (the summed
 * remainder), `sourcePaymentIds` (the selected PAID rows) and `sourceContext`
 * (the same rows for display) to prefill the modal.
 */
export function RecordRefundModal({
  orderId,
  open,
  onClose,
  initialAmount,
  sourcePaymentIds,
  sourceContext,
}: {
  orderId: string
  open: boolean
  onClose: () => void
  initialAmount?: number
  sourcePaymentIds?: string[]
  sourceContext?: RefundSourceContext[]
}) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.auth.user)
  const { data: paymentSettings } = useQuery({
    queryKey: ['payment-effective-settings'],
    queryFn: () => gatewayApi.getEffectivePaymentSettings(),
    enabled: open,
  })
  // DEFAULT ON — the toggle only ever RESTRICTS staff, it never enables them.
  const staffRefundsAllowed = paymentSettings?.global?.staffRefundsAllowed ?? true
  // Only gate on a LOADED user: while the auth state is still resolving the
  // backend stays the authority (a transient null user must never block a
  // refund the staff member is entitled to).
  const unavailableReason = user
    ? refundUnavailableReason({
        role: user.role,
        staffRefundsAllowed,
      })
    : null
  const [amount, setAmount] = useState(initialAmount !== undefined ? String(initialAmount) : '')
  const [method, setMethod] = useState('')
  const [reason, setReason] = useState('')
  const [cancelToo, setCancelToo] = useState(false)

  const refundMut = useMutation({
    mutationFn: () =>
      refundsApi.create({
        orderId,
        amount: parseFloat(amount),
        method: method.trim(),
        reason: reason.trim(),
        cancelToo,
        ...(sourcePaymentIds?.length ? { sourcePaymentIds } : {}),
      }),
    onSuccess: () => {
      toast.success(cancelToo ? 'Refund recorded and order cancelled' : 'Refund recorded')
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['payments-all'] })
      queryClient.invalidateQueries({ queryKey: ['refunds'] })
      onClose()
      setAmount(initialAmount !== undefined ? String(initialAmount) : '')
      setMethod('')
      setReason('')
      setCancelToo(false)
    },
    onError: (e: unknown) => {
      const err = e as any
      toast.error(err?.response?.data?.message || 'Failed to record refund')
    },
  })

  function handleSubmit() {
    if (unavailableReason) {
      toast.error(unavailableReason)
      return
    }
    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0) {
      toast.error('Enter a refund amount greater than 0')
      return
    }
    if (!method.trim()) {
      toast.error('Refund account/method is required')
      return
    }
    if (!reason.trim()) {
      toast.error('A reason is required for refunds')
      return
    }
    refundMut.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record refund</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {unavailableReason ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              {unavailableReason}
            </div>
          ) : null}
          {sourceContext?.length ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Refunding from {sourceContext.length} payment row{sourceContext.length > 1 ? 's' : ''}</p>
              {sourceContext.map((s) => (
                <p key={s.id} className="text-xs font-mono">
                  {s.gatewayCode} ৳{Number(s.amount).toLocaleString()} → remainder ৳{Number(s.remainder).toLocaleString()}
                </p>
              ))}
            </div>
          ) : null}
          <div>
            <Label htmlFor="record-refund-amount">Amount (৳)</Label>
            <Input
              id="record-refund-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-9 text-sm mt-1"
            />
          </div>
          <div>
            <Label htmlFor="record-refund-method">Refund to (account / method)</Label>
            <Input
              id="record-refund-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. bkash 017XXXXXXXX"
              className="h-9 text-sm mt-1"
            />
          </div>
          <div>
            <Label htmlFor="record-refund-reason">Reason</Label>
            <Textarea
              id="record-refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is this refunded?"
              className="text-sm mt-1"
            />
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <p className="text-sm font-medium">{REFUND_CANCEL_QUESTION}</p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="refund-cancel-too"
                checked={cancelToo}
                onChange={() => setCancelToo(true)}
                className="accent-primary"
              />
              Yes, cancel it now
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="refund-cancel-too"
                checked={!cancelToo}
                onChange={() => setCancelToo(false)}
                className="accent-primary"
              />
              No, later
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={refundMut.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={refundMut.isPending || !!unavailableReason}>
            {refundMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Record refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
