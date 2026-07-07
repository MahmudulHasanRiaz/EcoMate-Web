import { useState } from 'react'
import { useCartStore } from '../stores/cart-store'
import { CustomerQuickAdd } from './customer-quick-add'
import { DiscountModal } from './discount-modal'
import { PaymentModal } from './payment-modal'
import { Trash2, Percent, ShoppingCart, X, CreditCard, ChevronDown, Award, FileText } from 'lucide-react'

interface Props {
  onCloseSession: () => void
  isMobileDrawer?: boolean
  onCloseDrawer?: () => void
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

export function CartPanel({ onCloseSession, isMobileDrawer = false, onCloseDrawer }: Props) {
  const { 
    items, 
    updateQuantity, 
    removeItem, 
    orderDiscount, 
    orderDiscountType, 
    setOrderDiscount, 
    salesChannel, 
    setSalesChannel, 
    deliveryMethod, 
    setDeliveryMethod, 
    notes,
    setNotes,
    subtotal, 
    totalDiscount, 
    total 
  } = useCartStore()
  const [showNoteInput, setShowNoteInput] = useState(!!notes)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Drawer / Panel Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ShoppingCart size={16} />
          </div>
          <span className="text-sm font-bold text-slate-800">{items.length} items in cart</span>
        </div>
        
        <div className="flex items-center gap-3">
          {isMobileDrawer && onCloseDrawer && (
            <button 
              onClick={onCloseDrawer} 
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden cursor-pointer"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-6 text-slate-400">
            <ShoppingCart size={40} className="opacity-20 mb-3" />
            <p className="text-sm font-medium text-slate-400">Your cart is empty</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[200px]">Select category or search products above to add items.</p>
          </div>
        ) : (
          items.map((item, i) => (
            <div key={i} className="group flex items-center justify-between gap-2.5 rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 hover:border-slate-200 hover:bg-slate-50 transition-all">
              {/* Product Thumbnail */}
              {item.image ? (
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
                  <ShoppingCart size={14} className="opacity-40" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800" title={item.name}>{item.name}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                  <span className="text-[10px] font-semibold text-slate-400">৳{item.price.toLocaleString()} each</span>
                  {item.sku && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-slate-200" />
                      <span className="text-[9px] text-slate-400 font-mono">SKU: {item.sku}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Quantity Changer */}
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1 shrink-0">
                <button 
                  onClick={() => updateQuantity(i, item.quantity - 1)} 
                  className="flex h-6 w-6 items-center justify-center rounded bg-slate-50 text-xs font-black text-slate-600 hover:bg-slate-100 cursor-pointer active:scale-90 transition-transform"
                >
                  −
                </button>
                <span className="w-5 text-center text-xs font-bold text-slate-800">{item.quantity}</span>
                <button 
                  onClick={() => updateQuantity(i, item.quantity + 1)} 
                  className="flex h-6 w-6 items-center justify-center rounded bg-slate-50 text-xs font-black text-slate-600 hover:bg-slate-100 cursor-pointer active:scale-90 transition-transform"
                >
                  +
                </button>
              </div>

              <div className="w-16 text-right shrink-0">
                <span className="text-xs font-black text-slate-800">৳{(item.price * item.quantity).toLocaleString()}</span>
              </div>

              <button 
                onClick={() => removeItem(i)} 
                className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Cart Summary Form */}
      <div className="border-t border-slate-100 bg-slate-50/40 p-4 space-y-4 shadow-sm shrink-0">
        
        {/* Customer Assignment */}
        <CustomerQuickAdd />

        {/* Dropdowns */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="relative">
            <select
              className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-8 text-xs font-semibold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 cursor-pointer"
              value={salesChannel}
              onChange={(e) => setSalesChannel(e.target.value)}
            >
              {SALES_CHANNELS.map((sc) => (
                <option key={sc.value} value={sc.value}>{sc.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-8 text-xs font-semibold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 cursor-pointer"
              value={deliveryMethod}
              onChange={(e) => setDeliveryMethod(e.target.value)}
            >
              {DELIVERY_METHODS.map((dm) => (
                <option key={dm} value={dm}>{dm}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Order Note Option */}
        <div className="space-y-1.5 pt-0.5">
          {showNoteInput ? (
            <div className="relative">
              <textarea
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 pr-8 text-xs font-semibold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 placeholder:text-slate-400 resize-none"
                placeholder="Write internal order instructions or delivery notes..."
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button 
                type="button"
                onClick={() => {
                  setNotes('')
                  setShowNoteInput(false)
                }}
                className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-650 transition cursor-pointer"
                title="Remove note"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNoteInput(true)}
              className="inline-flex items-center gap-1.5 text-slate-500 hover:text-emerald-600 text-xs font-bold transition-colors cursor-pointer"
            >
              <FileText size={13} />
              <span>+ Add Order Note</span>
            </button>
          )}
        </div>

        {/* Totals Summary */}
        <div className="rounded-xl border border-slate-100 bg-white p-3 space-y-2 text-xs">
          <div className="flex justify-between text-slate-500 font-medium">
            <span>Subtotal</span>
            <span>৳{subtotal().toLocaleString()}</span>
          </div>
          {totalDiscount() > 0 && (
            <div className="flex justify-between text-emerald-600 font-semibold">
              <span className="flex items-center gap-1"><Award size={12} /> Discount</span>
              <span>-৳{totalDiscount().toLocaleString()}</span>
            </div>
          )}
          <div className="h-px bg-slate-100 my-1" />
          <div className="flex justify-between text-sm font-black text-slate-900">
            <span>Payable Total</span>
            <span className="text-base text-slate-950">৳{total().toLocaleString()}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => setDiscountOpen(true)}
            className={`col-span-1 flex items-center justify-center rounded-xl border transition-all duration-200 cursor-pointer active:scale-95 ${
              orderDiscount > 0
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
            title="Add discount"
          >
            <Percent size={18} />
          </button>
          
          <button
            onClick={() => setPaymentOpen(true)}
            disabled={items.length === 0}
            className="col-span-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 font-extrabold text-slate-950 shadow-md border border-emerald-400 hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all duration-200"
          >
            <CreditCard size={16} />
            <span className="truncate text-xs sm:text-sm">Pay ৳{total().toLocaleString()}</span>
          </button>
        </div>
      </div>

      <DiscountModal open={discountOpen} onOpenChange={setDiscountOpen} currentDiscount={orderDiscount} currentType={orderDiscountType} onApply={setOrderDiscount} />
      <PaymentModal open={paymentOpen} onOpenChange={setPaymentOpen} onSuccess={() => {}} />
    </div>
  )
}
