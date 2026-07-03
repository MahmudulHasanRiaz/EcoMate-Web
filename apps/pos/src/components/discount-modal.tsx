import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentDiscount: number
  currentType: 'flat' | 'percentage'
  onApply: (discount: number, type: 'flat' | 'percentage') => void
}

export function DiscountModal({ open, onOpenChange, currentDiscount, currentType, onApply }: Props) {
  const [amount, setAmount] = useState(String(currentDiscount))
  const [type, setType] = useState<'flat' | 'percentage'>(currentType)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
          <Dialog.Title className="mb-4 text-lg font-bold">Order Discount</Dialog.Title>

          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setType('flat')}
              className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                type === 'flat' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              ৳ Flat
            </button>
            <button
              onClick={() => setType('percentage')}
              className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                type === 'percentage' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              % Percentage
            </button>
          </div>

          <input
            className="w-full rounded-lg border p-3 text-lg text-center"
            type="number"
            min="0"
            step={type === 'percentage' ? '1' : 'any'}
            placeholder={type === 'percentage' ? 'Enter percentage' : 'Enter amount'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />

          <div className="mt-4 flex gap-2">
            <Dialog.Close className="flex-1 rounded-lg bg-gray-100 py-2 text-sm font-medium">Cancel</Dialog.Close>
            <Dialog.Close
              onClick={() => onApply(parseFloat(amount) || 0, type)}
              className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white"
            >
              Apply
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
