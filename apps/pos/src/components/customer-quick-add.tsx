import { useState } from 'react'
import { findCustomerByPhone, quickCreateCustomer } from '../api/client'
import { useCartStore } from '../stores/cart-store'
import { User, Plus } from 'lucide-react'

export function CustomerQuickAdd() {
  const { guestPhone, guestName, setCustomer, customerId } = useCartStore()
  const [phone, setPhone] = useState(guestPhone)
  const [name, setName] = useState(guestName)
  const [showForm, setShowForm] = useState(false)

  const handleLookup = async () => {
    if (!phone) return
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
    }
    setShowForm(false)
  }

  if (customerId) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <User size={16} className="text-green-600 shrink-0" />
        <span className="font-medium truncate">{guestName || guestPhone}</span>
        <button onClick={() => setCustomer(null, '', '')} className="text-xs text-red-500 shrink-0">Change</button>
      </div>
    )
  }

  if (!showForm) {
    return (
      <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-green-600">
        <Plus size={16} /> Add Customer
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <input
        className="w-28 rounded border px-2 py-1 text-sm"
        placeholder="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        autoFocus
      />
      <input
        className="flex-1 rounded border px-2 py-1 text-sm"
        placeholder="Name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button onClick={handleLookup} className="rounded bg-green-600 px-3 py-1 text-sm text-white shrink-0">Add</button>
    </div>
  )
}
