import { useState } from 'react'
import { X, Loader2, AlertTriangle, Check } from 'lucide-react'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl dark:bg-zinc-900 dark:border-zinc-800 transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between border-b pb-3 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-bold">Put Order on Hold</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <X className="h-5 w-5 text-zinc-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Select Reason <span className="text-red-500">*</span></p>
            <div className="grid grid-cols-2 gap-2.5">
              {HOLD_REASONS.map((r) => {
                const isSelected = reason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`flex items-center justify-between text-start p-4 rounded-xl border-2 transition-all cursor-pointer font-medium text-sm
                      ${isSelected 
                        ? 'border-amber-500 bg-amber-50/50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-300' 
                        : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50/50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-300 dark:hover:border-zinc-700'
                      }`}
                  >
                    <span>{r}</span>
                    {isSelected && <Check className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
              rows={3}
              placeholder="Provide context or details about the issue..."
            />
          </div>

          <div className="flex gap-3 pt-2 border-t dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 py-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason || isSubmitting}
              className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600 active:bg-amber-700 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Confirm Hold'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
