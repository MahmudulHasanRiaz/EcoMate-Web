import { useState, FormEvent } from 'react'
import { loginApi } from '../api/client'
import { Store, KeyRound, Mail, Loader2 } from 'lucide-react'

interface Props { onSuccess: () => void }

export function LoginPage({ onSuccess }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await loginApi(email, password)
      const { accessToken, user } = res.data
      if (!['cashier', 'admin', 'superadmin'].includes(user.role)) {
        setError('Access denied. Cashier or admin role required.')
        return
      }
      localStorage.setItem('pos_access_token', accessToken)
      onSuccess()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-slate-950">
      {/* Dynamic ambient background shapes */}
      <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-emerald-500/10 blur-[100px]" />
      <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-teal-500/10 blur-[100px]" />

      <form 
        onSubmit={handleSubmit} 
        className="glass-dark relative z-10 w-full max-w-md rounded-2xl p-8 text-white shadow-2xl transition-all duration-300"
      >
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
            <Store size={28} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-100">EcoMate POS</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your checkout terminal</p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400 animate-in fade-in slide-in-from-top-1 duration-200">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
                type="email"
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
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
              <span>Signing you in...</span>
            </>
          ) : (
            <span>Launch POS Terminal</span>
          )}
        </button>
      </form>
    </div>
  )
}
