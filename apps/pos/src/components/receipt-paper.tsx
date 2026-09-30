import {
  ReceiptData,
  formatReceiptMoney,
  formatReceiptDateTime,
} from '../lib/receipt'

function DashedRule() {
  return (
    <div
      aria-hidden
      className="my-1.5 border-t border-dashed border-slate-900/70"
    />
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
      <span className="text-right font-bold">{value}</span>
    </div>
  )
}

/**
 * An 80mm thermal-paper invoice. Purely presentational — the same
 * markup renders on screen (modal preview) and on paper (hidden
 * print target inside ThermalReceiptModal). Monospace styling keeps
 * columns aligned on real thermal printers.
 */
export function ReceiptPaper({ receipt }: { receipt: ReceiptData }) {
  const units = receipt.lines.reduce((s, l) => s + l.quantity, 0)

  return (
    <div className="w-full bg-white px-1 py-1 font-mono text-black">
      {/* Store header */}
      <div className="text-center">
        <p className="text-[13px] font-bold uppercase leading-tight tracking-wide">
          {receipt.storeName}
        </p>
        <p className="text-[9px] uppercase tracking-[0.2em] text-slate-700">
          Thermal Invoice
        </p>
      </div>

      <DashedRule />

      <MetaRow label="Invoice" value={receipt.orderNo} />
      <MetaRow label="Date" value={formatReceiptDateTime(receipt.createdAt)} />
      {receipt.cashierName && (
        <MetaRow label="Cashier" value={receipt.cashierName} />
      )}

      <DashedRule />

      {/* Line items */}
      {receipt.lines.length === 0 ? (
        <p className="py-1 text-center text-[10px]">No items</p>
      ) : (
        receipt.lines.map((line, i) => (
          <div key={i} className="mb-1.5">
            <p className="text-[11px] font-bold leading-snug">
              {i + 1}. {line.name}
            </p>
            <div className="flex justify-between gap-2 text-[10px]">
              <span className="text-slate-700">
                {line.quantity} × {formatReceiptMoney(line.price)}
                {line.sku ? `  ·  SKU: ${line.sku}` : ''}
              </span>
              <span className="font-bold">
                {formatReceiptMoney(line.lineTotal)}
              </span>
            </div>
          </div>
        ))
      )}

      <DashedRule />

      {/* Totals */}
      <MetaRow label="Subtotal" value={formatReceiptMoney(receipt.subtotal)} />
      {receipt.discount > 0 && (
        <MetaRow
          label="Discount"
          value={`-${formatReceiptMoney(receipt.discount)}`}
        />
      )}
      <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-slate-900/70 pt-1.5">
        <span className="text-[12px] font-bold uppercase tracking-wide">
          Total{units > 0 ? ` (${units} pcs)` : ''}
        </span>
        <span className="text-[14px] font-black">
          {formatReceiptMoney(receipt.total)}
        </span>
      </div>

      <DashedRule />

      {/* Payment breakdown */}
      {receipt.payments.map((p, i) => (
        <MetaRow key={i} label={p.method} value={formatReceiptMoney(p.amount)} />
      ))}

      {/* Customer / notes */}
      {(receipt.customerName || receipt.customerPhone) && (
        <>
          <DashedRule />
          {receipt.customerName && (
            <MetaRow label="Customer" value={receipt.customerName} />
          )}
          {receipt.customerPhone && (
            <MetaRow label="Phone" value={receipt.customerPhone} />
          )}
        </>
      )}
      {receipt.notes && (
        <>
          <DashedRule />
          <p className="text-[9px] uppercase tracking-wide">Note</p>
          <p className="text-[10px] leading-snug">{receipt.notes}</p>
        </>
      )}

      <DashedRule />

      {/* Footer */}
      <div className="text-center">
        <p className="text-[11px] font-bold">Thank you!</p>
        <p className="text-[8px] uppercase tracking-[0.2em] text-slate-700">
          Powered by EcoMate
        </p>
      </div>
    </div>
  )
}
