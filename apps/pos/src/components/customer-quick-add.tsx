import { useState } from 'react'
import { findCustomerByPhone, quickCreateCustomer } from '../api/client'
import { useCartStore } from '../stores/cart-store'
import { User, Plus, X, Search, Check } from 'lucide-react'

export function CustomerQuickAdd() {
  const { guestPhone, guestName, setCustomer, customerId } = useCartStore()
  const [phone, setPhone] = useState(guestPhone)
  const [name, setName] = useState(guestName)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLookup = async () => {
    if (!phone) return
    setLoading(true)
    try {
      const res = await findCustomerByPhone(phone)
      if (res.data?.length > 0) {
        const c = res.data[0]
        setCustomer(c.id, (c.firstName || '') + ' ' + (c.lastName || ''), c.phoneNumber)
        setName((c.firstName || '') + ' ' + (c.lastName || ''))
      } else {
        const created = await quickCreateCustomer(phone, name || undefined)
        const d = created.data
        setCustomer(d.id, d.firstName || name, phone)
      }
    } catch {
      try {
        const created = await quickCreateCustomer(phone, name || undefined)
        const d = created.data
        setCustomer(d.id, d.firstName || name, phone)
      } catch { /* fail silently */ }
    } finally {
      setLoading(false)
    }
    setShowForm(false)
  }

  if (customerId) {
    return (
      <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-100 p-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 shrink-0">
            <User size={14} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-slate-800">{guestName || 'Anonymous Customer'}</p>
            <p className="text-[10px] text-slate-400 font-semibold">{guestPhone}</p>
          </div>
        </div>
        <button 
          onClick={() => { setCustomer(null, '', ''); setPhone(''); setName('') }} 
          className="rounded-lg p-1 text-slate-400 hover:bg-emerald-100 hover:text-rose-600 transition shrink-0 cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  if (!showForm) {
    return (
      <button 
        onClick={() => setShowForm(true)} 
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-semibold text-slate-500 hover:border-emerald-500/40 hover:text-emerald-600 hover:bg-slate-50 transition cursor-pointer"
      >
        <Plus size={14} />
        <span>Assign Customer</span>
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5 shadow-sm animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Add Customer Details</span>
        <button 
          onClick={() => setShowForm(false)} 
          className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          className="w-28 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
          placeholder="Phone No"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
        <input
          className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
          placeholder="Customer Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button 
          onClick={handleLookup} 
          disabled={loading || !phone}
          className="flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 px-3 text-white hover:bg-slate-800 active:scale-95 disabled:opacity-40 cursor-pointer transition"
        >
          {loading ? '...' : <Check size={14} />}
        </button>
      </div>
    </div>
  )
}
