import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { paymentsApi } from '@/features/payments/api'

const GATEWAYS = ['cash', 'bkash', 'nagad', 'bank', 'card']

/**
 * Record a ledger payment (D1: stays SIMPLE — amount, gateway/account, txn,
 * note; no date picker, server sets recordedAt). txnRequired mirrors S1:
 * required exactly when the entry will sit PENDING (S1 OFF). A resolver makes
 * it PER-GATEWAY (D: tri-state override ?? global).
 */
export function RecordPaymentModal({
  orderId,
  open,
  onClose,
  txnRequired,
}: {
  orderId: string
  open: boolean
  onClose: () => void
  txnRequired: boolean | ((gatewayCode: string) => boolean)
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [gatewayCode, setGatewayCode] = useState('cash')
  const [account, setAccount] = useState('')
  const [transactionId, setTransactionId] = useState('')
  const [notes, setNotes] = useState('')
  const needsTxn =
    typeof txnRequired === 'function' ? txnRequired(gatewayCode) : txnRequired

  const recordMut = useMutation({
    mutationFn: () =>
      paymentsApi.record(orderId, {
        gatewayCode,
        amount: parseFloat(amount),
        account: account.trim() || undefined,
        transactionId: transactionId.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Payment recorded')
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['payments-all'] })
      onClose()
      setAmount('')
      setTransactionId('')
      setNotes('')
    },
    onError: (e: unknown) => {
      const err = e as any
      toast.error(err?.response?.data?.message || 'Failed to record payment')
    },
  })

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0) {
      toast.error('Enter an amount greater than 0')
      return
    }
    if (!account.trim()) {
      toast.error('Account is required for manual gateway payments')
      return
    }
    if (needsTxn && !transactionId.trim()) {
      toast.error('Transaction ID is required for payments awaiting verification')
      return
    }
    recordMut.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="record-pay-amount">Amount (৳)</Label>
            <Input
              id="record-pay-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-9 text-sm mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="record-pay-gateway">Gateway</Label>
              <select
                id="record-pay-gateway"
                value={gatewayCode}
                onChange={(e) => setGatewayCode(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm mt-1"
              >
                {GATEWAYS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="record-pay-account">Account</Label>
              <Input
                id="record-pay-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="Receiving account"
                className="h-9 text-sm mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="record-pay-txn">
              Transaction ID{' '}
              <span className="text-muted-foreground font-normal">
                ({needsTxn ? 'required — entry needs verification' : 'optional — auto-verified'})
              </span>
            </Label>
            <Input
              id="record-pay-txn"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              placeholder="TrxID"
              className="h-9 text-sm mt-1 font-mono"
            />
          </div>
          <div>
            <Label htmlFor="record-pay-note">Note (optional)</Label>
            <Textarea
              id="record-pay-note"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Why is this payment recorded?"
              className="text-sm mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={recordMut.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={recordMut.isPending}>
            {recordMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
