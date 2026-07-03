import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useCartStore } from '../stores/cart-store'
import { createPosOrder } from '../api/client'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function PaymentModal({ open, onOpenChange, onSuccess }: Props) {
  const { items, orderDiscount, orderDiscountType, customerId, guestName, guestPhone, salesChannel, deliveryMethod, notes, clearCart, total, subtotal } = useCartStore()
  const cartTotal = total()

  const [splits, setSplits] = useState<{ method: string; amount: string }[]>([
    { method: 'CASH', amount: cartTotal.toFixed(2) },
  ])
  const [loading, setLoading] = useState(false)

  // Reset splits when modal opens with new total
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
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
          <Dialog.Title className="mb-1 text-xl font-bold">Payment</Dialog.Title>
          <p className="mb-4 text-3xl font-bold text-green-700">৳{cartTotal.toLocaleString()}</p>

          <div className="mb-4 space-y-2">
            {splits.map((sp, i) => (
              <div key={i} className="flex gap-2">
                <select
                  className="rounded-lg border px-2 py-2 text-sm"
                  value={sp.method}
                  onChange={(e) => updateSplit(i, 'method', e.target.value)}
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="MOBILE_BANKING">Mobile Banking</option>
                </select>
                <input
                  className="flex-1 rounded-lg border px-3 py-2 text-right text-lg"
                  type="number"
                  min="0"
                  step="any"
                  value={sp.amount}
                  onChange={(e) => updateSplit(i, 'amount', e.target.value)}
                />
                {splits.length > 1 && (
                  <button onClick={() => removeSplit(i)} className="px-2 text-red-500">×</button>
                )}
              </div>
            ))}
            <button onClick={addSplit} className="text-sm text-green-600 hover:underline">+ Add split payment</button>
            {Math.abs(difference) > 0.01 && (
              <p className="text-sm text-orange-500">Remaining: ৳{difference.toLocaleString()}</p>
            )}
          </div>

          <div className="flex gap-2">
            <Dialog.Close className="flex-1 rounded-lg bg-gray-100 py-3 text-sm font-medium">Cancel</Dialog.Close>
            <button
              onClick={handlePay}
              disabled={!isValid || loading}
              className="flex-1 rounded-lg bg-green-600 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? 'Processing...' : `Pay ৳${cartTotal.toLocaleString()}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
