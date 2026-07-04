import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { HoldFormData } from './types'

const HOLD_REASONS = [
  'Product Missing',
  'Stock Issue',
  'Damaged Product',
  'Waiting for Approval',
  'Customer Request',
  'Other',
]

interface Props {
  orderId: string
  onClose: () => void
  onSubmit: (data: HoldFormData) => void
  isSubmitting: boolean
}

export function HoldModal({ orderId, onClose, onSubmit, isSubmitting }: Props) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason) return
    onSubmit({ reason, notes: notes || undefined })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Hold Order</h2>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Reason</p>
            {HOLD_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50 cursor-pointer">
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-4 w-4"
                />
                {r}
              </label>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border p-2 text-sm"
              rows={3}
              placeholder="Add any notes..."
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason || isSubmitting}
              className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Submit Hold'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
