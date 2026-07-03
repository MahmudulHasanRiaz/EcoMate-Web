import { useState } from 'react'
import { useCartStore } from '../stores/cart-store'
import { CustomerQuickAdd } from './customer-quick-add'
import { DiscountModal } from './discount-modal'
import { PaymentModal } from './payment-modal'
import { Trash2, Percent, ShoppingCart } from 'lucide-react'

interface Props {
  onCloseSession: () => void
}

const DELIVERY_METHODS = ['Counter Sale', 'Takeaway', 'Home Delivery', 'Courier']
const SALES_CHANNELS = [
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'CALL', label: 'Call' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'MESSENGER', label: 'Messenger' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'THREADS', label: 'Threads' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'OTHER', label: 'Other' },
]

export function CartPanel({ onCloseSession }: Props) {
  const { items, updateQuantity, removeItem, orderDiscount, orderDiscountType, setOrderDiscount, salesChannel, setSalesChannel, deliveryMethod, setDeliveryMethod, subtotal, totalDiscount, total } = useCartStore()
  const [discountOpen, setDiscountOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  return (
    <div className="flex h-full flex-col border-l bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex items-center gap-2">
          <ShoppingCart size={18} />
          <span className="font-semibold">{items.length} items</span>
        </div>
        <button onClick={onCloseSession} className="text-sm text-orange-600 hover:underline">
          Close Session
        </button>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="mt-8 text-center text-sm text-gray-400">No items in cart</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-gray-50 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-gray-500">৳{item.price.toLocaleString()} each</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQuantity(i, item.quantity - 1)} className="h-7 w-7 rounded bg-gray-200 text-sm font-bold">−</button>
                  <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                  <button onClick={() => updateQuantity(i, item.quantity + 1)} className="h-7 w-7 rounded bg-gray-200 text-sm font-bold">+</button>
                </div>
                <p className="w-20 text-right text-sm font-semibold">৳{(item.price * item.quantity).toLocaleString()}</p>
                <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="space-y-2 border-t p-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Subtotal</span>
          <span>৳{subtotal().toLocaleString()}</span>
        </div>
        {totalDiscount() > 0 && (
          <div className="flex justify-between text-sm text-green-600">
            <span>Discount</span>
            <span>-৳{totalDiscount().toLocaleString()}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>৳{total().toLocaleString()}</span>
        </div>

        {/* Customer */}
        <CustomerQuickAdd />

        {/* Sales Channel */}
        <select
          className="w-full rounded border px-2 py-1 text-sm"
          value={salesChannel}
          onChange={(e) => setSalesChannel(e.target.value)}
        >
          {SALES_CHANNELS.map((sc) => (
            <option key={sc.value} value={sc.value}>{sc.label}</option>
          ))}
        </select>

        {/* Delivery Method */}
        <select
          className="w-full rounded border px-2 py-1 text-sm"
          value={deliveryMethod}
          onChange={(e) => setDeliveryMethod(e.target.value)}
        >
          {DELIVERY_METHODS.map((dm) => (
            <option key={dm} value={dm}>{dm}</option>
          ))}
        </select>

        {/* Discount button */}
        <button
          onClick={() => setDiscountOpen(true)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <Percent size={16} />
          {orderDiscount > 0 ? `Discount: ${orderDiscount}${orderDiscountType === 'percentage' ? '%' : '৳'}` : 'Add Discount'}
        </button>

        {/* Pay */}
        <button
          onClick={() => setPaymentOpen(true)}
          disabled={items.length === 0}
          className="w-full rounded-lg bg-green-600 py-3 text-lg font-bold text-white hover:bg-green-700 disabled:opacity-50"
        >
          Pay ৳{total().toLocaleString()}
        </button>
      </div>

      <DiscountModal open={discountOpen} onOpenChange={setDiscountOpen} currentDiscount={orderDiscount} currentType={orderDiscountType} onApply={setOrderDiscount} />
      <PaymentModal open={paymentOpen} onOpenChange={setPaymentOpen} onSuccess={() => {}} />
    </div>
  )
}
