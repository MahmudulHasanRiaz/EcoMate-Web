import { useState } from 'react'
import { closeSession } from '../api/client'
import { useSessionStore } from '../stores/session-store'
import { toast } from 'sonner'

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

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="mb-2 text-2xl font-bold text-gray-800">Close Session</h1>
        <p className="mb-6 text-gray-500">{showroomName}</p>

        <label className="mb-2 block text-sm font-medium text-gray-600">Closing Balance (৳)</label>
        <input
          className="mb-4 w-full rounded-lg border border-gray-300 p-3 text-lg"
          type="number"
          min="0"
          step="any"
          placeholder="Enter cash in drawer"
          value={closingBalance}
          onChange={(e) => setClosingBalance(e.target.value)}
          autoFocus
        />

        <label className="mb-2 block text-sm font-medium text-gray-600">Notes (optional)</label>
        <textarea
          className="mb-6 w-full rounded-lg border border-gray-300 p-3 text-sm"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any notes about this session..."
        />

        <button
          onClick={handleClose}
          disabled={loading || !closingBalance}
          className="w-full rounded-lg bg-orange-600 py-3 text-lg font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? 'Closing...' : 'Close Session'}
        </button>
      </div>
    </div>
  )
}
