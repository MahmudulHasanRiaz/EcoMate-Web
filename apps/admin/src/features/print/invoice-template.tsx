import Barcode from 'react-barcode'

const nm = (v: number | string) => Number(v)
const fmt = (v: number | string) => nm(v).toFixed(2)

export function InvoiceTemplate({ order }: { order: any }) {
  if (!order) return null

  const subtotal = order.items?.reduce((s: number, i: any) => s + nm(i.price) * i.quantity, 0) || 0

  return (
    <div className="invoice-container">
      <style>{`
        @page { size: A4; margin: 12mm; }
        .invoice-container { font-family: 'Inter', sans-serif; color: #111; max-width: 210mm; }
        .no-print { display: none !important; }
      `}</style>

      <div className="flex items-center justify-between border-b pb-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">EcoMate</h1>
          <p className="text-sm text-muted-foreground">01800000000</p>
          <p className="text-xs text-muted-foreground">Dhaka, Bangladesh</p>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold uppercase tracking-wide">Invoice</h2>
          <div className="mt-2">
            <Barcode value={order.displayId || order.id} width={1.2} height={28} fontSize={9} margin={1} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Billed To</p>
          <p className="font-medium">{order.customer?.firstName} {order.customer?.lastName}</p>
          <p className="text-sm text-muted-foreground">{order.customer?.phoneNumber}</p>
          <p className="text-sm text-muted-foreground">{order.customer?.email}</p>
          <p className="text-sm text-muted-foreground">{typeof order.shippingAddress === 'string' ? order.shippingAddress : order.shippingAddress?.address || ''}</p>
        </div>
        <div className="text-right">
          <div className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Invoice #:</span> {order.displayId}</p>
            <p><span className="text-muted-foreground">Date:</span> {new Date(order.createdAt).toLocaleDateString()}</p>
            <p><span className="text-muted-foreground">Status:</span> {order.status?.name}</p>
          </div>
        </div>
      </div>

      <table className="w-full border-collapse mb-4 text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2">Qty</th>
            <th className="text-right py-2">Price</th>
            <th className="text-right py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items?.map((item: any, i: number) => (
            <tr key={i} className="border-b">
              <td className="py-2">{item.product?.name || 'Product'}</td>
              <td className="text-right py-2">{item.quantity}</td>
              <td className="text-right py-2">৳{fmt(item.price)}</td>
              <td className="text-right py-2">৳{fmt(nm(item.price) * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-4">
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>৳{fmt(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>৳{fmt(order.shippingCharge)}</span></div>
          {nm(order.discount) > 0 && <div className="flex justify-between text-green-600"><span className="text-muted-foreground">Discount ({order.discountType})</span><span>-৳{fmt(order.discount)}</span></div>}
          <div className="flex justify-between font-bold text-base border-t pt-1.5"><span>Total</span><span>৳{fmt(order.total)}</span></div>
        </div>
      </div>

      {order.customerNotes && <p className="text-xs text-muted-foreground mb-4 italic">{order.customerNotes}</p>}

      <div className="text-center text-xs text-muted-foreground mt-8 pt-4 border-t">
        <p>Thank you for your purchase!</p>
        <p>EcoMate — Sustainable Shopping</p>
      </div>
    </div>
  )
}
