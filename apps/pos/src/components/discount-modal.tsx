import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Percent, PercentCircle, X, Check } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentDiscount: number
  currentType: 'flat' | 'percentage'
  onApply: (discount: number, type: 'flat' | 'percentage') => void
}

const QUICK_PERCENTAGES = [5, 10, 15, 20]
const QUICK_FLATS = [50, 100, 200, 500]

export function DiscountModal({ open, onOpenChange, currentDiscount, currentType, onApply }: Props) {
  const [amount, setAmount] = useState(String(currentDiscount))
  const [type, setType] = useState<'flat' | 'percentage'>(currentType)

  // Sync state when modal opens
  useEffect(() => {
    if (open) {
      setAmount(String(currentDiscount))
      setType(currentType)
    }
  }, [open, currentDiscount, currentType])

  const handleQuickSelect = (value: number) => {
    setAmount(String(value))
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 outline-none animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <Dialog.Title className="text-base font-bold text-slate-800 flex items-center gap-2">
              <PercentCircle size={18} className="text-emerald-500" />
              <span>Order Discount</span>
            </Dialog.Title>
            <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition cursor-pointer">
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* Segmented control tabs */}
          <div className="mb-4 flex rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => { setType('flat'); setAmount('0') }}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
                type === 'flat' 
                  ? 'bg-white text-slate-900 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              ৳ Flat Cash
            </button>
            <button
              onClick={() => { setType('percentage'); setAmount('0') }}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
                type === 'percentage' 
                  ? 'bg-white text-slate-900 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              % Percentage
            </button>
          </div>

          {/* Direct Input */}
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
              {type === 'flat' ? '৳' : '%'}
            </span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-9 pr-4 text-center text-2xl font-black text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"
              type="number"
              min="0"
              step={type === 'percentage' ? '1' : 'any'}
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>

          {/* Quick Selection Chips */}
          <div className="mt-4">
            <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Quick Presets</span>
            <div className="flex gap-2">
              {(type === 'percentage' ? QUICK_PERCENTAGES : QUICK_FLATS).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleQuickSelect(val)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-bold transition cursor-pointer active:scale-95 ${
                    amount === val.toString()
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {type === 'flat' ? '৳' : ''}{val}{type === 'percentage' ? '%' : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <Dialog.Close className="flex-1 rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-500 hover:bg-slate-200 transition cursor-pointer">
              Cancel
            </Dialog.Close>
            
            <Dialog.Close
              onClick={() => onApply(parseFloat(amount) || 0, type)}
              className="flex-1 rounded-xl bg-emerald-500 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 shadow-md border border-emerald-400 transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Check size={14} />
              <span>Apply Discount</span>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
