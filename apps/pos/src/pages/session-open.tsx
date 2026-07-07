import { useState, FormEvent } from 'react'
import { openSession, getActiveSession } from '../api/client'
import { useSessionStore } from '../stores/session-store'
import { Calculator, ArrowLeft, Loader2, Landmark } from 'lucide-react'

interface Props { onOpened: () => void }

const QUICK_DENOMINATIONS = [0, 500, 1000, 2000, 5000]

export function SessionOpenPage({ onOpened }: Props) {
  const [openingBalance, setOpeningBalance] = useState('1000')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { showroomId, showroomName, setSession, clearSession } = useSessionStore()

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

  const handleBack = () => {
    clearSession()
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-slate-950 p-6">
      {/* Background radial glowing blobs */}
      <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-emerald-500/5 blur-[120px]" />
      <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-teal-500/5 blur-[120px]" />

      <form 
        onSubmit={handleSubmit} 
        className="glass-dark relative z-10 w-full max-w-md rounded-2xl p-8 text-white shadow-2xl transition-all duration-300"
      >
        <button 
          type="button"
          onClick={handleBack}
          className="absolute left-6 top-6 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition cursor-pointer"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="mb-8 flex flex-col items-center mt-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
            <Landmark size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-100">Open Session</h1>
          <p className="mt-1.5 text-sm text-slate-400 text-center">{showroomName}</p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400 animate-in fade-in slide-in-from-top-1 duration-200">
            {error}
          </div>
        )}

        <div className="space-y-6">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3.5">
              Opening Cash Drawer Balance (৳)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-500">৳</span>
              <input
                className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-4 pl-9 pr-4 text-3xl font-extrabold text-slate-100 outline-none transition focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
                type="number"
                min="0"
                step="any"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              Quick Selection
            </label>
            <div className="flex flex-wrap gap-2">
              {QUICK_DENOMINATIONS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setOpeningBalance(val.toString())}
                  className={`rounded-xl px-4 py-2.5 text-xs font-bold transition border cursor-pointer active:scale-95 ${
                    openingBalance === val.toString()
                      ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                      : 'bg-slate-900 border-slate-850 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  ৳{val.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Opening drawer...</span>
            </>
          ) : (
            <span>Start Business Session</span>
          )}
        </button>
      </form>
    </div>
  )
}
