import { useState, FormEvent } from 'react'
import { loginApi } from '../api/client'

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
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-green-600 to-green-800">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-800">EcoMate POS</h1>
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        <input
          className="mb-4 w-full rounded-lg border border-gray-300 p-3 text-lg"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <input
          className="mb-6 w-full rounded-lg border border-gray-300 p-3 text-lg"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-green-600 p-3 text-lg font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
