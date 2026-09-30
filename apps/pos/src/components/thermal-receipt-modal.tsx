import * as Dialog from '@radix-ui/react-dialog'
import { Printer, X, CheckCircle } from 'lucide-react'
import { ReceiptData } from '../lib/receipt'
import { ReceiptPaper } from './receipt-paper'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  receipt: ReceiptData | null
}

/**
 * Shown after every successful POS payment and from any
 * order-list reprint. The modal previews the 80mm receipt;
 * "Print" hands it to the browser print dialog where the
 * cashier picks the thermal printer.
 *
 * The hidden `#thermal-receipt-print` node is the only thing
 * that survives into the printed page — see the @media print
 * rules in index.css.
 */
export function ThermalReceiptModal({ open, onOpenChange, receipt }: Props) {
  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl border border-slate-100 outline-none animate-in fade-in zoom-in-95 duration-200">
            {/* Thank-you confirmation — this single modal replaces a separate
                "thank you" popup. It surfaces the order id and the print
                action together so checkout lands on exactly one screen. */}
            <div className="relative text-center mb-4">
              <Dialog.Title className="text-xl font-bold text-emerald-700 flex items-center justify-center gap-2">
                <CheckCircle size={22} />
                <span>Thank you for your order!</span>
              </Dialog.Title>
              <p className="mt-1 text-xs text-slate-500">Your order has been submitted.</p>
              <p className="mt-1 text-[10px] font-mono text-slate-400 break-all">Order ID: {receipt?.orderNo || '—'}</p>
              <Dialog.Close className="absolute top-0 right-0 rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition cursor-pointer">
                <X size={16} />
              </Dialog.Close>
            </div>

            {/* Paper preview */}
            <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-3 mb-4">
              <div
                className="mx-auto rounded-[2px] bg-white shadow-md"
                style={{ width: '80mm' }}
              >
                {receipt && <ReceiptPaper receipt={receipt} />}
              </div>
            </div>

            <p className="mb-4 text-[11px] font-semibold text-slate-400">
              80mm roll paper · choose your thermal printer in the
              print dialog
            </p>

            <div className="mt-6 flex gap-2">
              <Dialog.Close className="flex-1 rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-500 hover:bg-slate-200 transition cursor-pointer">
                Close
              </Dialog.Close>
              <button
                onClick={() => window.print()}
                disabled={!receipt}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-3 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-md border border-emerald-400 transition cursor-pointer"
              >
                <Printer size={14} />
                <span>Print Thermal Receipt</span>
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Print-only target: hidden on screen, isolated by the
          @media print rules. Kept mounted while a receipt is
          open so window.print() always has something to emit. */}
      {open && receipt && (
        <div id="thermal-receipt-print">
          <ReceiptPaper receipt={receipt} />
        </div>
      )}
    </>
  )
}
