import { useState } from 'react'
import { closeSession } from '../api/client'
import { useSessionStore } from '../stores/session-store'
import { toast } from 'sonner'
import { Landmark, ArrowLeft, Loader2, FileText, AlertTriangle } from 'lucide-react'

interface Props { onClosed: () => void }

export function SessionClosePage({ onClosed }: Props) {
  const { sessionId, showroomName, clearSession } = useSessionStore()
  const [closingBalance, setClosingBalance] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const handleClose = async () => {
    if (!closingBalance) return
    setLoading(true)
    try {
      await closeSession(sessionId!, parseFloat(closingBalance), notes || undefined)
      toast.success('Session closed successfully')
      localStorage.removeItem('pos_session_id')
      clearSession()
      onClosed()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to close session')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    onClosed() // Go back to POS
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-slate-950 p-6">
      {/* Dynamic background gradients */}
      <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-orange-500/5 blur-[120px]" />
      <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-red-500/5 blur-[120px]" />

      <div 
        className="glass-dark relative z-10 w-full max-w-md rounded-2xl p-8 text-white shadow-2xl transition-all duration-300 animate-in fade-in zoom-in-95 duration-200"
      >
        <button 
          type="button"
          onClick={handleCancel}
          className="absolute left-6 top-6 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition cursor-pointer"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="mb-8 flex flex-col items-center mt-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30">
            <Landmark size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-100">Close Session</h1>
          <p className="mt-1.5 text-sm text-slate-400 text-center">{showroomName}</p>
        </div>

        {/* Warning alert panel */}
        <div className="mb-6 flex gap-3 rounded-xl bg-orange-500/10 border border-orange-500/20 p-4 text-xs text-orange-400">
          <AlertTriangle size={18} className="shrink-0" />
          <p>
            Closing this session will finalize the active drawer, summarize all payments, and lock cash registers. Verify actual cash before closing.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Closing Drawer Cash Balance (৳)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-500">৳</span>
              <input
                className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-9 pr-4 text-xl font-bold text-slate-100 placeholder-slate-600 outline-none transition focus:border-orange-500 focus:bg-slate-900 focus:ring-2 focus:ring-orange-500/20"
                type="number"
                min="0"
                step="any"
                placeholder="Enter cash in drawer"
                value={closingBalance}
                onChange={(e) => setClosingBalance(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Closing Notes (optional)
            </label>
            <div className="relative">
              <FileText className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
              <textarea
                className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition focus:border-orange-500 focus:bg-slate-900 focus:ring-2 focus:ring-orange-500/20"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about adjustments, sales count discrepancies..."
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleClose}
          disabled={loading || !closingBalance}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-orange-400 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Closing session...</span>
            </>
          ) : (
            <span>Lock & Close Session</span>
          )}
        </button>
      </div>
    </div>
  )
}
