import Barcode from 'react-barcode'
import { User, Phone, MapPin } from 'lucide-react'

const nm = (v: number | string) => Number(v)
const fmt = (v: number | string) => nm(v).toFixed(0)

export function StickerTemplate({ order }: { order: any }) {
  if (!order) return null

  return (
    <div className="sticker-container">
      <style>{`
        @page { size: 75mm 100mm; margin: 0; }
        .sticker-container {
          width: 75mm; min-height: 100mm; padding: 3mm 4mm;
          font-family: 'Poppins', 'Inter', sans-serif; font-size: 9px; color: #000;
          box-sizing: border-box; background: #fff;
        }
        .sticker-container .barcode-wrapper { margin: 2mm 0; display: flex; justify-content: center; }
        .sticker-container .barcode-wrapper svg { max-width: 100%; height: auto; }
        .sticker-container .row { display: flex; justify-content: space-between; }
        .sticker-container .product-list { max-height: 28px; overflow: hidden; }
        .sticker-container .divider { border-top: 1px dashed #ccc; margin: 2mm 0; }
      `}</style>

      <div className="font-bold text-xs text-center mb-1">EcoMate</div>
      <div className="text-[8px] text-center text-muted-foreground mb-1">01800000000</div>

      <div className="divider" />

      <div className="space-y-0.5 mb-2">
        <div className="flex items-center gap-1 text-[9px] font-medium"><User className="h-3 w-3" /> {order.customer?.firstName} {order.customer?.lastName}</div>
        <div className="flex items-center gap-1 text-[8px]"><Phone className="h-3 w-3" /> {order.customer?.phoneNumber}</div>
        <div className="flex items-center gap-1 text-[8px]"><MapPin className="h-3 w-3" /> {typeof order.shippingAddress === 'string' ? order.shippingAddress : order.shippingAddress?.address || order.shippingAddress?.district || ''}</div>
      </div>

      <div className="barcode-wrapper">
        <Barcode value={order.displayId || order.id} width={1.3} height={32} fontSize={8} margin={2} />
      </div>

      <div className="row font-bold text-xs mt-1">
        <span>COD: ৳{fmt(order.total)}</span>
        <span>{order.displayId}</span>
      </div>

      <div className="product-list mt-1">
        {order.items?.map((item: any, i: number) => (
          <div key={i} className="row text-[7px]">
            <span className="truncate flex-1">{item.product?.name}</span>
            <span className="ml-1">×{item.quantity}</span>
            <span className="ml-1">৳{fmt(item.price)}</span>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="row text-[7px]">
        <span>Total: ৳{fmt(order.total)}</span>
        <span>Shipping: ৳{fmt(order.shippingCharge)}</span>
        <span>{new Date(order.createdAt).toLocaleDateString('en-GB')}</span>
      </div>
    </div>
  )
}
