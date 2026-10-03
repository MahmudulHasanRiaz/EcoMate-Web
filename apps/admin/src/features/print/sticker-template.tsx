import Barcode from 'react-barcode'
import { QRCodeSVG } from 'qrcode.react'
import { User, Phone, MapPin } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { mediaUrl } from '@/lib/utils'
import { getCustomerDisplayName, getCustomerPhone } from '@/lib/order-display'

function fmt(v: number | string): string {
  const n = Math.round(Number(v) || 0)
  return n.toLocaleString('en-US')
}

function getAmountFontSize(val: number | string, base = 34): number {
  const str = fmt(val)
  if (str.length >= 8) return base - 8
  if (str.length >= 6) return base - 4
  return base
}

function getCustomerAddress(order: any): string {
  const sa = order?.shippingAddress
  if (!sa) return ''
  if (typeof sa === 'string') return sa
  if (typeof sa === 'object') {
    const parts = [
      sa.address || sa.addressLine || sa.street || sa.line1 || '',
      sa.line2 || sa.area || '',
      sa.city || sa.thana || '',
      sa.zone || sa.district || sa.state || '',
      sa.postcode || sa.zip || '',
    ].filter(Boolean)
    return parts.join(', ')
  }
  return ''
}

export function getCourierInfo(order: any) {
  const latestDispatch = Array.isArray(order?.dispatches) && order.dispatches.length > 0
    ? order.dispatches[0]
    : null

  const courierSlug = (latestDispatch?.courier || order?.courierService || '').toLowerCase().trim()
  const consignmentId = (latestDispatch?.consignmentId || order?.courierConsignmentId || '').trim()
  const trackingCode = (latestDispatch?.trackingCode || order?.courierTrackingCode || '').trim()

  let parcelId = ''
  let courierName = ''
  let title = 'CONSIGNMENT NO.'

  if (courierSlug === 'steadfast') {
    courierName = 'Steadfast'
    parcelId = consignmentId || trackingCode
    title = 'STEADFAST CONSIGNMENT NO.'
  } else if (courierSlug === 'pathao') {
    courierName = 'Pathao'
    parcelId = consignmentId || trackingCode
    title = 'PATHAO PARCEL ID'
  } else if (courierSlug === 'carrybee') {
    courierName = 'Carrybee'
    parcelId = consignmentId || trackingCode
    title = 'CARRYBEE PARCEL ID'
  } else if (courierSlug === 'redx') {
    courierName = 'RedX'
    parcelId = trackingCode || consignmentId
    title = 'REDX PARCEL ID'
  } else if (courierSlug) {
    const capitalized = courierSlug.charAt(0).toUpperCase() + courierSlug.slice(1)
    courierName = capitalized
    parcelId = consignmentId || trackingCode
    title = `${courierSlug.toUpperCase()} PARCEL ID`
  }

  const isDispatched = Boolean(parcelId)

  return {
    isDispatched,
    courierName,
    title,
    barcodeValue: parcelId,
  }
}

export function getItemProductInfo(item: any): {
  baseName: string
  variantBadge: string
  fullTitle: string
} {
  const baseName = item.product?.name || item.name || 'Item'

  let variantText = ''
  if (Array.isArray(item.variant?.attributeValues) && item.variant.attributeValues.length > 0) {
    variantText = item.variant.attributeValues
      .map((av: any) => av?.attributeValue?.value || av?.value)
      .filter(Boolean)
      .join(', ')
  } else if (item.variant?.name) {
    variantText = item.variant.name
  } else if (item.variantTitle) {
    variantText = item.variantTitle
  }

  const variantBadge = variantText ? `(${variantText})` : ''
  const fullTitle = variantBadge ? `${baseName} ${variantBadge}` : baseName

  return { baseName, variantBadge, fullTitle }
}

export function formatItemTitle(item: any): string {
  return getItemProductInfo(item).fullTitle
}

function CodHandBoxIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2l5 2.5v5l-5 2.5-5-2.5v-5L14 2z" />
      <path d="M14 7v5" />
      <path d="M9 4.5l5 2.5 5-2.5" />
      <path d="M1 12v6" />
      <path d="M4 12v6" />
      <path d="M4 16h6l3.5-3h4.5a1.5 1.5 0 0 1 1.5 1.5v.5a1.5 1.5 0 0 1-1.5 1.5h-3.5" />
    </svg>
  )
}

function CardPaymentIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="3" width="22" height="16" rx="2.5" />
      <line x1="1" y1="8" x2="23" y2="8" strokeWidth="2" />
      <rect x="4" y="12" width="4" height="3" rx="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

function DeliveryTruckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 4h12v11H1z" />
      <path d="M13 8h5l3 3.5v3.5h-8z" />
      <circle cx="5.5" cy="16.5" r="2" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="16.5" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CoinsStackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 28 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Left stack (4 coins) */}
      <ellipse cx="8" cy="4" rx="6" ry="2" />
      <path d="M2 4v3c0 1.1 2.7 2 6 2s6-.9 6-2V4" />
      <path d="M2 7v3c0 1.1 2.7 2 6 2s6-.9 6-2V7" />
      <path d="M2 10v3c0 1.1 2.7 2 6 2s6-.9 6-2v-3" />
      {/* Right stack (2 coins) */}
      <ellipse cx="18" cy="9" rx="5" ry="1.8" />
      <path d="M13 9v3c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V9" />
    </svg>
  )
}

function CalendarDateIcon({ className = 'h-5 w-5', size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="4" width="18" height="17" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9H21" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 2V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 2V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="13" r="1.1" fill="currentColor" />
      <circle cx="12" cy="13" r="1.1" fill="currentColor" />
      <circle cx="16" cy="13" r="1.1" fill="currentColor" />
      <circle cx="8" cy="17" r="1.1" fill="currentColor" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
      <circle cx="16" cy="17" r="1.1" fill="currentColor" />
    </svg>
  )
}

export function StickerTemplate({ order }: { order: any }) {
  const { data: settings } = useQuery({
    queryKey: ['storefront-config'],
    queryFn: () => apiClient.get('/system-settings/storefront').then(r => r.data),
  })

  if (!order) return null

  const storeName = settings?.store?.name || ''
  const storePhone = settings?.store?.phone || ''
  const storeLogo = settings?.branding?.storeLogo || ''
  const storefrontFavicon = settings?.branding?.storefrontFavicon || ''
  const display = settings?.systems?.[0]?.display || 'name'
  const currencySymbol = settings?.currency?.symbol || '৳'

  const customerName = getCustomerDisplayName(order)
  const customerPhone = getCustomerPhone(order)
  const customerAddress = getCustomerAddress(order)

  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' })
    : ''

  const courierInfo = getCourierInfo(order)

  const totalAmount = Number(order.total || 0)
  const deliveryCharge = Number(order.shippingCharge || 0)

  const paidAmount = Array.isArray(order.payments)
    ? order.payments
        .filter((p: any) => {
          const s = (p.status || '').toLowerCase()
          return s === 'paid' || s === 'verified' || s === 'completed'
        })
        .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0)
    : (order.paymentStatus === 'PAID' ? totalAmount : 0)

  const codAmount = Math.max(0, totalAmount - paidAmount)

  const items = Array.isArray(order.items) ? order.items : []

  return (
    <div className="sticker-container">
      <style>{`
        @page {
          size: 75mm 100mm;
          margin: 0;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .sticker-container {
            page-break-after: always;
            page-break-inside: avoid;
            box-shadow: none !important;
          }
          .sticker-container:last-child {
            page-break-after: auto;
          }
        }
        .sticker-container {
          width: 75mm;
          height: 100mm;
          max-height: 100mm;
          padding: 3mm 3.5mm;
          font-family: 'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #000;
          box-sizing: border-box;
          background: #fff;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          overflow: hidden;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .sticker-logo {
          max-height: 7.5mm;
          max-width: 45mm;
          object-fit: contain;
          margin: 0 auto;
          display: block;
        }
        .sticker-favicon {
          max-height: 5mm;
          max-width: 8mm;
          object-fit: contain;
        }
      `}</style>

      {/* Top Header & Customer Details */}
      <div className="flex-shrink-0">
        {/* Store Branding Header (Left) + Vertical Divider + Order Date (Right) */}
        <div className="flex items-center justify-between gap-1">
          {/* Left: Store Branding (Preserves existing display logic) */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center">
            {display === 'logo' ? (
              storeLogo ? (
                <img src={mediaUrl(storeLogo)} alt={storeName || 'store'} className="sticker-logo" />
              ) : (
                <div className="font-extrabold text-sm text-black tracking-tight">{storeName}</div>
              )
            ) : display === 'name+logo' ? (
              <div className="flex items-center justify-center gap-1.5">
                {storefrontFavicon ? (
                  <img src={mediaUrl(storefrontFavicon)} alt="" className="sticker-favicon" />
                ) : null}
                <span className="font-extrabold text-sm text-black tracking-tight">{storeName || '—'}</span>
              </div>
            ) : (
              <div className="font-extrabold text-sm text-black tracking-tight">{storeName || '—'}</div>
            )}
            {storePhone && (
              <div className="text-[8.5px] font-semibold text-center text-gray-800 tracking-tight mt-0.5">
                {storePhone}
              </div>
            )}
          </div>

          {/* Vertical divider */}
          <div className="w-px h-8 bg-gray-300 mx-1 flex-shrink-0" />

          {/* Right: Order Date */}
          <div className="flex items-center gap-1.5 flex-shrink-0 pr-1">
            <CalendarDateIcon className="h-5 w-5 text-black flex-shrink-0" />
            <div className="flex flex-col">
              <span className="text-[7.5px] font-medium text-gray-500 leading-none">Order Date</span>
              <span className="text-[10px] font-black text-black tracking-tight mt-0.5 leading-none">
                {orderDate || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Dashed divider */}
        <div className="border-t border-dashed border-gray-300 my-1" />

        {/* Customer Information Card */}
        <div className="bg-[#f8fafc] border border-gray-100 rounded-xl px-2 py-1 space-y-0.5">
          {/* Row 1: Name (left 50%) + Divider + Phone (right 50%) */}
          <div className="flex items-center justify-between gap-1">
            {/* Left half: Customer Name */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <User className="h-3.5 w-3.5 text-black flex-shrink-0" strokeWidth={2} />
              <span className="text-[9.5px] font-bold text-black truncate">{customerName}</span>
            </div>

            {/* Vertical divider */}
            <div className="w-px h-3.5 bg-gray-300 mx-1 flex-shrink-0" />

            {/* Right half: Customer Phone */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-start">
              <Phone className="h-3.5 w-3.5 text-black flex-shrink-0" strokeWidth={2} />
              <span className="text-[9px] font-bold text-black tracking-tight truncate">
                {customerPhone || '—'}
              </span>
            </div>
          </div>

          {/* Row 2: Customer Address full width */}
          {customerAddress && (
            <div className="flex items-start gap-1.5 text-[8px] font-medium text-gray-800 leading-tight pt-0.5">
              <MapPin className="h-3.5 w-3.5 text-black flex-shrink-0 mt-0.5" strokeWidth={2} />
              <span className="line-clamp-2">{customerAddress}</span>
            </div>
          )}
        </div>

        {/* Codes Section: Order QR Code (left) + Courier Barcode (right) */}
        <div className="bg-[#f8fafc] rounded-xl px-2 py-1 my-1 grid grid-cols-2 gap-2 items-center">
          {/* Left: QR Code + Order Info */}
          <div className="flex items-center gap-1.5 pr-1.5 border-r border-dashed border-gray-300">
            <div className="flex-shrink-0 bg-white p-0.5 rounded">
              <QRCodeSVG
                value={order.displayId || order.id || 'ORDER'}
                size={36}
                level="M"
                marginSize={0}
              />
            </div>
            <div className="flex flex-col items-center justify-center flex-1 text-center min-w-0">
              <span className="text-[7px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-0.5">
                ORDER
              </span>
              <span className="text-[8px] font-black text-black tracking-tight leading-tight whitespace-nowrap">
                {order.displayId || order.id}
              </span>
              <div className="w-full border-t border-gray-200 my-0.5" />
              <span className="text-[6.5px] font-medium text-gray-500 leading-tight">
                Scan to view<br />order details
              </span>
            </div>
          </div>

          {/* Right: Courier Barcode Box */}
          <div className="flex flex-col items-center justify-center min-h-[46px] overflow-hidden">
            <span className="text-[6.5px] font-bold tracking-tight text-gray-800 uppercase text-center mb-0.5 truncate max-w-full">
              {courierInfo.title}
            </span>
            {courierInfo.isDispatched ? (
              <>
                <div className="flex justify-center items-center overflow-hidden max-w-full">
                  <Barcode
                    value={courierInfo.barcodeValue}
                    format="CODE128"
                    width={0.88}
                    height={18}
                    displayValue={false}
                    margin={0}
                    background="transparent"
                  />
                </div>
                <span className="text-[8px] font-black text-black tracking-wider text-center mt-0.5">
                  {courierInfo.barcodeValue}
                </span>
              </>
            ) : (
              <div className="py-1 px-1 flex flex-col items-center justify-center text-center">
                <span className="text-[8px] font-semibold text-gray-700">Not yet dispatched to courier</span>
                <span className="text-[6.5px] text-gray-400 mt-0.5">Courier entry pending</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Products Table Section */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden my-0.5">
        {/* Table Header */}
        <div className="bg-[#f3f4f6] rounded-md px-1.5 py-0.5 flex items-center text-[7.5px] font-bold text-gray-900 mb-0.5 flex-shrink-0">
          <span className="w-4 text-left">#</span>
          <span className="flex-1 text-left">Product</span>
          <span className="w-7 text-right">Qty</span>
          <span className="w-11 text-right">Price</span>
          <span className="w-11 text-right">Amount</span>
        </div>

        {/* Product Items List */}
        <div className="space-y-0.5 overflow-hidden flex-1">
          {items.slice(0, 8).map((item: any, i: number) => {
            const { baseName, variantBadge, fullTitle } = getItemProductInfo(item)
            const qty = Number(item.quantity) || 1
            const price = Number(item.price) || 0
            const amount = qty * price
            return (
              <div key={item.id || i} className="flex items-center text-[7.5px] leading-tight text-gray-900 py-[1px]">
                <span className="w-4 text-left text-gray-600 font-medium flex-shrink-0">{i + 1}</span>
                <div className="flex-1 text-left min-w-0 flex items-center pr-1 overflow-hidden" title={fullTitle}>
                  <span className="truncate font-medium">{baseName}</span>
                  {variantBadge && (
                    <span className="flex-shrink-0 font-bold text-gray-900 ml-1 whitespace-nowrap">
                      {variantBadge}
                    </span>
                  )}
                </div>
                <span className="w-7 text-right font-medium flex-shrink-0">×{qty}</span>
                <span className="w-11 text-right font-medium flex-shrink-0">{currencySymbol}{fmt(price)}</span>
                <span className="w-11 text-right font-medium flex-shrink-0">{currencySymbol}{fmt(amount)}</span>
              </div>
            )
          })}
          {items.length > 8 && (
            <div className="text-[6.5px] text-gray-500 italic text-center py-0.5">
              +{items.length - 8} more item(s)
            </div>
          )}
        </div>
      </div>

      {/* Dashed divider above footer */}
      <div className="border-t border-dashed border-gray-300 my-1 flex-shrink-0" />

      {/* Bottom Bill Summary Card (Pixel-perfect vector replica of reference design) */}
      <div className="bill-summary-card w-full flex-shrink-0 select-none">
        <svg
          viewBox="0 0 720 102"
          className="w-full h-auto block"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* 1. Outer Dark Capsule */}
          <rect x="0" y="0" width="720" height="102" rx="22" ry="22" fill="#18191c" />

          {/* 2. White Cutout Area */}
          <path
            d="
              M 32 2.5
              H 518
              C 528 2.5, 536 7, 538 17
              C 542 35, 546 48, 550 62
              C 555 78, 560 92, 572 99.5
              H 32
              C 15 95, 2 80, 2 51
              C 2 22, 15 7, 32 2.5
              Z
            "
            fill="#ffffff"
          />

          {/* 3. Dividers */}
          <line x1="183" y1="14" x2="183" y2="88" stroke="#d1d5db" strokeWidth="1.2" />
          <line x1="358" y1="14" x2="358" y2="88" stroke="#d1d5db" strokeWidth="1.2" />

          {/* ================= 1. COD (Centered at x=105.5) ================= */}
          <g
            transform="translate(74, 13)"
            stroke="#000000"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <path d="M13 1l5.5 3v6l-5.5 3-5.5-3v-6L13 1z" />
            <path d="M13 7v6" />
            <path d="M7.5 4l5.5 3 5.5-3" />
            <path d="M1 13v7" />
            <path d="M4.5 13v7" />
            <path d="M4.5 18h6l4.5-3.5h4.5a1.8 1.8 0 0 1 1.8 1.8v0.4a1.8 1.8 0 0 1-1.8 1.8h-4" />
          </g>
          <text
            x="104"
            y="29"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize="14"
            fontWeight="900"
            fill="#000000"
            letterSpacing="0.3"
          >
            COD
          </text>
          <text
            x="105.5"
            y="80"
            textAnchor="middle"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize={getAmountFontSize(codAmount, 34)}
            fontWeight="900"
            fill="#000000"
            letterSpacing="-1"
          >
            {currencySymbol}{fmt(codAmount)}
          </text>

          {/* ================= 2. PAID AMOUNT (Centered at x=270.5) ================= */}
          <g
            transform="translate(206, 15)"
            stroke="#000000"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <rect x="1" y="1" width="24" height="18" rx="3.5" />
            <line x1="1" y1="6.5" x2="25" y2="6.5" strokeWidth="2.6" />
            <rect x="4" y="11.5" width="4.5" height="2.5" rx="0.6" fill="#000000" stroke="none" />
          </g>
          <text
            x="237"
            y="29"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize="13"
            fontWeight="800"
            fill="#000000"
            letterSpacing="0.3"
          >
            PAID AMOUNT
          </text>
          <text
            x="270.5"
            y="80"
            textAnchor="middle"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize={getAmountFontSize(paidAmount, 34)}
            fontWeight="900"
            fill="#000000"
            letterSpacing="-1"
          >
            {currencySymbol}{fmt(paidAmount)}
          </text>

          {/* ================= 3. DELIVERY CHARGE (Centered at x=448) ================= */}
          <g
            transform="translate(368, 15)"
            stroke="#000000"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <path d="M1 2h14v13H1z" />
            <path d="M15 6h5.5l3.5 4v5H15z" />
            <circle cx="5.5" cy="15" r="2.2" fill="#000000" stroke="none" />
            <circle cx="18.5" cy="15" r="2.2" fill="#000000" stroke="none" />
          </g>
          <text
            x="398"
            y="29"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize="12.5"
            fontWeight="800"
            fill="#000000"
            letterSpacing="0.2"
          >
            DELIVERY CHARGE
          </text>
          <text
            x="448"
            y="80"
            textAnchor="middle"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize={getAmountFontSize(deliveryCharge, 34)}
            fontWeight="900"
            fill="#000000"
            letterSpacing="-1"
          >
            {currencySymbol}{fmt(deliveryCharge)}
          </text>

          {/* ================= 4. TOTAL AMOUNT (Centered at x=629) ================= */}
          <g
            transform="translate(558, 13)"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <ellipse cx="8" cy="4.5" rx="7" ry="2.5" />
            <path d="M1 4.5v3.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V4.5" />
            <path d="M1 8v3.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V8" />
            <path d="M1 11.5v3.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V11.5" />
            <ellipse cx="19" cy="10" rx="5.5" ry="2" />
            <path d="M13.5 10v3.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V10" />
          </g>
          <text
            x="591"
            y="29"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize="13"
            fontWeight="800"
            fill="#ffffff"
            letterSpacing="0.3"
          >
            TOTAL AMOUNT
          </text>
          <text
            x="629"
            y="80"
            textAnchor="middle"
            fontFamily="'Inter', -apple-system, sans-serif"
            fontSize={getAmountFontSize(totalAmount, 35)}
            fontWeight="900"
            fill="#ffffff"
            letterSpacing="-1"
          >
            {currencySymbol}{fmt(totalAmount)}
          </text>
        </svg>
      </div>
    </div>
  )
}
