import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useCartStore } from '../stores/cart-store'
import { createPosOrder } from '../api/client'
import { toast } from 'sonner'
import { CreditCard, X, Plus, Trash2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'MOBILE_BANKING', label: 'Mobile Banking' },
]

export function PaymentModal({ open, onOpenChange, onSuccess }: Props) {
  const { items, orderDiscount, orderDiscountType, customerId, guestName, guestPhone, salesChannel, deliveryMethod, notes, clearCart, total } = useCartStore()
  const cartTotal = total()

  const [splits, setSplits] = useState<{ method: string; amount: string }[]>([
    { method: 'CASH', amount: cartTotal.toFixed(2) },
  ])
  const [loading, setLoading] = useState(false)

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setSplits([{ method: 'CASH', amount: cartTotal.toFixed(2) }])
    }
    onOpenChange(open)
  }

  const addSplit = () => setSplits([...splits, { method: 'CARD', amount: '0' }])

  const updateSplit = (i: number, field: 'method' | 'amount', value: string) => {
    const next = [...splits]
    next[i] = { ...next[i], [field]: value }
    setSplits(next)
  }

  const removeSplit = (i: number) => setSplits(splits.filter((_, idx) => idx !== i))

  const splitTotal = splits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)
  const difference = cartTotal - splitTotal
  const isValid = Math.abs(difference) < 0.01 && splits.every((sp) => parseFloat(sp.amount) > 0)

  const handleQuickCash = (amount: number) => {
    // Set the first split amount to the quick cash selection
    if (splits.length > 0) {
      updateSplit(0, 'amount', amount.toFixed(2))
    }
  }

  const handlePay = async () => {
    if (!isValid) return
    setLoading(true)
    try {
      await createPosOrder({
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          price: i.price,
        })),
        payments: splits.map((sp) => ({
          method: sp.method,
          amount: parseFloat(sp.amount),
        })),
        discount: orderDiscount || undefined,
        discountType: orderDiscountType,
        customerId: customerId || undefined,
        guestName: guestName || undefined,
        guestPhone: guestPhone || undefined,
        salesChannel,
        deliveryMethod,
        notes: notes || undefined,
      })
      toast.success('Order completed!')
      clearCart()
      onSuccess()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Payment failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 outline-none animate-in fade-in zoom-in-95 duration-200">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-4">
            <Dialog.Title className="text-base font-bold text-slate-800 flex items-center gap-2">
              <CreditCard size={18} className="text-emerald-500" />
              <span>Checkout Settlement</span>
            </Dialog.Title>
            <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition cursor-pointer">
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* Amount Display */}
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 mb-5 text-center">
            <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Payable Total</span>
            <p className="text-3xl font-black text-slate-900">৳{cartTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>

          {/* Quick Cash Presets (only applies to first split for quick operations) */}
          <div className="mb-5">
            <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Quick Cash Presets</span>
            <div className="flex gap-2">
              {[500, 1000, 2000, 5000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => handleQuickCash(amt)}
                  className="flex-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 py-2.5 active:scale-95 transition cursor-pointer"
                >
                  ৳{amt.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* Split Payments List */}
          <div className="space-y-3 mb-5 max-h-[30vh] overflow-y-auto pr-1">
            <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Payment Breakdown</span>
            
            {splits.map((sp, i) => (
              <div key={i} className="flex gap-2.5 items-center">
                {/* Method selector */}
                <div className="relative w-36 shrink-0">
                  <select
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-8 text-xs font-bold text-slate-700 outline-none transition focus:border-emerald-500 cursor-pointer"
                    value={sp.method}
                    onChange={(e) => updateSplit(i, 'method', e.target.value)}
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm.value} value={pm.value}>{pm.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                {/* Amount Input */}
                <input
                  className="flex-1 rounded-xl border border-slate-200 py-2 pl-3 pr-3.5 text-right text-base font-extrabold text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                  type="number"
                  min="0"
                  step="any"
                  value={sp.amount}
                  onChange={(e) => updateSplit(i, 'amount', e.target.value)}
                />

                {splits.length > 1 && (
                  <button 
                    onClick={() => removeSplit(i)} 
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition shrink-0 cursor-pointer"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}

            <div className="flex items-center justify-between mt-2.5">
              <button 
                onClick={addSplit} 
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
              >
                <Plus size={14} />
                <span>Add split payment</span>
              </button>

              {/* Status Verification Bar */}
              {Math.abs(difference) > 0.01 ? (
                <div className="flex items-center gap-1 text-[11px] font-bold text-orange-500">
                  <AlertCircle size={12} />
                  <span>Remaining: ৳{difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                  <CheckCircle2 size={12} />
                  <span>Settlement matches total</span>
                </div>
              )}
            </div>
          </div>

          {/* Dialog Action Buttons */}
          <div className="mt-6 flex gap-2">
            <Dialog.Close className="flex-1 rounded-xl bg-slate-100 py-3.5 text-xs font-bold text-slate-500 hover:bg-slate-200 transition cursor-pointer">
              Cancel
            </Dialog.Close>
            
            <button
              onClick={handlePay}
              disabled={!isValid || loading}
              className="flex-1 rounded-xl bg-emerald-500 py-3.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-md border border-emerald-400 transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              {loading ? (
                <span>Settling...</span>
              ) : (
                <span>Complete Checkout</span>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
