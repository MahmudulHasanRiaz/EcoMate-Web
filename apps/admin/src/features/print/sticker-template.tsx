import Barcode from 'react-barcode'
import { User, Phone, MapPin } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { mediaUrl } from '@/lib/utils'

const nm = (v: number | string) => Number(v)
const fmt = (v: number | string) => nm(v).toFixed(0)

export function StickerTemplate({ order }: { order: any }) {
  const { data: settings } = useQuery({
    queryKey: ['storefront-config'],
    queryFn: () => apiClient.get('/system-settings/storefront').then(r => r.data)
  })
  const storeName = settings?.store?.name || ''
  const storePhone = settings?.store?.phone || ''
  const storeLogo = settings?.branding?.storeLogo || ''
  const currencySymbol = settings?.currency?.symbol || '৳'
  if (!order) return null

  const sa = order.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : {}
  const customerName =
    order.customer?.firstName ||
    order.guestName ||
    order.shippingAddress?.name ||
    ''
  const customerPhone =
    order.customer?.phoneNumber ||
    order.guestPhone ||
    order.shippingAddress?.phone ||
    ''
  const customerAddress =
    sa.address || sa.addressLine || (typeof order.shippingAddress === 'string' ? order.shippingAddress : sa.district) || ''

  return (
    <div className="sticker-container">
      <style>{`
        @page { size: 75mm 100mm; margin: 0; }
        .sticker-container {
          width: 75mm; height: 100mm; padding: 3mm 4mm;
          font-family: 'Poppins', 'Inter', sans-serif; font-size: 9px; color: #000;
          box-sizing: border-box; background: #fff;
        }
        .sticker-container .barcode-wrapper { margin: 2mm 0; display: flex; justify-content: center; }
        .sticker-container .barcode-wrapper svg { max-width: 100%; height: auto; }
        .sticker-container .row { display: flex; justify-content: space-between; }
        .sticker-container .product-list { max-height: 28px; overflow: hidden; }
        .sticker-container .divider { border-top: 1px dashed #ccc; margin: 2mm 0; }
        .sticker-logo { max-height: 6mm; max-width: 30mm; object-fit: contain; margin: 0 auto; display: block; }
      `}</style>

      <div className="text-center mb-1">
        {storeLogo ? (
          <img src={mediaUrl(storeLogo)} alt={storeName || 'store'} className="sticker-logo" />
        ) : (
          <div className="font-bold text-xs">{storeName}</div>
        )}
      </div>
      {storePhone && <div className="text-[8px] text-center text-muted-foreground mb-1">{storePhone}</div>}

      <div className="divider" />

      <div className="space-y-0.5 mb-2">
        <div className="row text-[9px]">
          <span className="font-medium"><User className="h-3 w-3 inline mr-0.5" />{customerName || '—'}</span>
          <span className="text-[7px] text-muted-foreground">{new Date(order.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' })}</span>
        </div>
        {customerPhone && <div className="flex items-center gap-1 text-[8px]"><Phone className="h-3 w-3" /> {customerPhone}</div>}
        {customerAddress && <div className="flex items-center gap-1 text-[8px]"><MapPin className="h-3 w-3" /> {customerAddress}</div>}
      </div>

      <div className="barcode-wrapper">
        <Barcode value={order.displayId || order.id} width={1.3} height={32} fontSize={8} margin={2} />
      </div>

      <div className="row font-bold text-xs mt-1">
        <span>COD: {currencySymbol}{fmt(order.total)}</span>
      </div>

      <div className="product-list mt-1">
        {order.items?.map((item: any, i: number) => (
          <div key={i} className="row text-[7px]">
            <span className="truncate flex-1">{item.product?.name}</span>
            <span className="ml-1">×{item.quantity}</span>
            <span className="ml-1">{currencySymbol}{fmt(item.price)}</span>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div className="row text-[7px]">
        <span>Delivery Charge:</span>
        <span>{currencySymbol}{fmt(order.shippingCharge)}</span>
      </div>
      <div className="row text-[9px] font-bold mt-0.5">
        <span>Total</span>
        <span>{currencySymbol}{fmt(order.total)}</span>
      </div>
    </div>
  )
}
