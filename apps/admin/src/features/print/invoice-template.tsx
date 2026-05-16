import Barcode from 'react-barcode'

const nm = (v: number | string) => Number(v)
const fmt = (v: number | string) => nm(v).toFixed(2)

export function InvoiceTemplate({ order }: { order: any }) {
  if (!order) return null

  const subtotal = order.items?.reduce((s: number, i: any) => s + nm(i.price) * i.quantity, 0) || 0

  return (
    <div className="invoice-container">
      <style>{`
        .invoice-container { font-family: 'Inter', sans-serif; color: #111; max-width: 210mm; }
        @page { margin: 12mm; }
        @media print {
          .invoice-container { page-break-after: avoid; overflow: hidden; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">EcoMate</h1>
          <p className="text-xs text-muted-foreground">01800000000</p>
          <p className="text-xs text-muted-foreground">Dhaka, Bangladesh</p>
          <p className="text-xs text-muted-foreground mt-1">TRN: 123456789</p>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold uppercase tracking-wider">Invoice</h2>
          <div className="mt-1">
            <Barcode value={order.displayId || order.id} width={1} height={24} fontSize={8} margin={0} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Bill To</p>
          <p className="font-semibold text-sm">{order.customer?.firstName} {order.customer?.lastName}</p>
          <p className="text-sm text-muted-foreground">{order.customer?.phoneNumber}</p>
          {order.customer?.email && <p className="text-sm text-muted-foreground">{order.customer?.email}</p>}
          <p className="text-sm text-muted-foreground mt-1">{typeof order.shippingAddress === 'string' ? order.shippingAddress : order.shippingAddress?.address || order.shippingAddress?.district || ''}</p>
        </div>
        <div className="text-right">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-end gap-2"><span className="text-muted-foreground">Invoice #</span><span className="font-mono font-medium">{order.displayId}</span></div>
            <div className="flex justify-end gap-2"><span className="text-muted-foreground">Date</span><span>{new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
            <div className="flex justify-end gap-2"><span className="text-muted-foreground">Status</span><span className="font-medium">{order.status?.name}</span></div>
            {order.courierService && <div className="flex justify-end gap-2"><span className="text-muted-foreground">Courier</span><span className="capitalize">{order.courierService}</span></div>}
          </div>
        </div>
      </div>

      <table className="w-full border-collapse mb-6 text-sm">
        <thead>
          <tr className="border-y-2 border-black bg-muted/20">
            <th className="text-left py-2.5 px-2 w-8">#</th>
            <th className="text-left py-2.5">Item</th>
            <th className="text-right py-2.5 w-16">Qty</th>
            <th className="text-right py-2.5 w-24">Price</th>
            <th className="text-right py-2.5 w-24">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items?.map((item: any, i: number) => (
            <tr key={i} className="border-b">
              <td className="py-2 px-2 text-muted-foreground">{i + 1}</td>
              <td className="py-2">{item.product?.name || 'Product'}</td>
              <td className="text-right py-2">{item.quantity}</td>
              <td className="text-right py-2">৳{fmt(item.price)}</td>
              <td className="text-right py-2 font-medium">৳{fmt(nm(item.price) * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-6">
        <div className="w-72 space-y-2 text-sm border-t-2 border-black pt-3">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>৳{fmt(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Delivery Charge</span><span>৳{fmt(order.shippingCharge)}</span></div>
          {nm(order.discount) > 0 && (
            <div className="flex justify-between text-green-600"><span className="text-muted-foreground">Discount ({order.discountType === 'percentage' ? `${order.discount}%` : 'flat'})</span><span>-৳{fmt(order.discount)}</span></div>
          )}
          <div className="flex justify-between font-bold text-base border-t border-double pt-2 mt-1">
            <span>Total</span><span className="text-lg">৳{fmt(order.total)}</span>
          </div>
        </div>
      </div>

      {order.customerNotes && (
        <div className="mb-4 p-3 bg-muted/20 rounded text-xs text-muted-foreground italic">
          <span className="font-medium not-italic">Note:</span> {order.customerNotes}
        </div>
      )}

      {order.payments?.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Payment</p>
          <div className="flex flex-wrap gap-2">
            {order.payments.map((p: any) => (
              <span key={p.id} className="text-xs bg-muted/30 rounded px-2 py-0.5">
                {p.method?.toUpperCase()}: ৳{fmt(p.amount)} ({p.status})
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="text-center text-[10px] text-muted-foreground mt-8 pt-4 border-t">
        <p className="font-medium text-black mb-0.5">EcoMate — Sustainable Shopping</p>
        <p>This is a computer-generated invoice. No signature required.</p>
      </div>
    </div>
  )
}
