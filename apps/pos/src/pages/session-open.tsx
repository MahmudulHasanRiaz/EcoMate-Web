import { useState, FormEvent } from 'react'
import { openSession, getActiveSession } from '../api/client'
import { useSessionStore } from '../stores/session-store'

interface Props { onOpened: () => void }

export function SessionOpenPage({ onOpened }: Props) {
  const [openingBalance, setOpeningBalance] = useState('0')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { showroomId, showroomName, setSession } = useSessionStore()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const existing = await getActiveSession(showroomId!)
      if (existing.data) {
        setSession({
          id: existing.data.id,
          showroomId: existing.data.showroomId,
          showroomName: existing.data.showroom.name,
          cashierName: '',
        })
        onOpened()
        return
      }

      const res = await openSession(showroomId!, parseFloat(openingBalance) || 0)
      const session = res.data
      setSession({
        id: session.id,
        showroomId: session.showroomId,
        showroomName: session.showroom.name,
        cashierName: '',
      })
      localStorage.setItem('pos_session_id', session.id)
      onOpened()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to open session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="mb-2 text-2xl font-bold text-gray-800">Open Session</h1>
        <p className="mb-6 text-gray-500">{showroomName}</p>
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        <label className="mb-2 block text-sm font-medium text-gray-600">Opening Balance (৳)</label>
        <input
          className="mb-6 w-full rounded-lg border border-gray-300 p-3 text-lg"
          type="number"
          min="0"
          step="any"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-green-600 p-3 text-lg font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Opening...' : 'Start Session'}
        </button>
      </form>
    </div>
  )
}
