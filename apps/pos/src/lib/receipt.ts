/**
 * Thermal receipt data model + builders for POS printing.
 *
 * Two sources feed a receipt:
 *  1. Fresh POS order — `createPosOrder` response carries only
 *     productId/variantId on items, so names come from the cart
 *     (passed via `cartItems`).
 *  2. Reprint of an old order — `GET /pos/orders/:id` includes
 *     product/variant/combo relations, so names come from the DB.
 *
 * Customer identity always prefers the frozen order-time snapshot
 * fields (customerFirstName/…) over the mutable CustomerProfile,
 * matching the Order model invariant.
 */

export interface ReceiptLine {
  name: string
  sku?: string
  quantity: number
  price: number
  lineTotal: number
}

export interface ReceiptPayment {
  method: string
  amount: number
}

export interface ReceiptData {
  storeName: string
  orderNo: string
  createdAt: string
  cashierName?: string
  customerName?: string
  customerPhone?: string
  lines: ReceiptLine[]
  subtotal: number
  discount: number
  total: number
  payments: ReceiptPayment[]
  notes?: string
}

export interface ReceiptContext {
  storeName?: string
  cashierName?: string
  cartItems?: Array<{
    productId?: string
    variantId?: string
    name: string
    sku?: string
  }>
}

interface OrderItemLike {
  productId?: string | null
  variantId?: string | null
  quantity?: number
  price?: number | string
  product?: { name?: string; sku?: string | null } | null
  variant?: {
    sku?: string | null
    attributeValues?: Array<{ attributeValue?: { value?: string } | null } | null> | null
  } | null
  combo?: { name?: string } | null
}

interface PosOrderLike {
  displayId?: string
  createdAt?: string
  subtotal?: number | string
  discount?: number | string
  total?: number | string
  customerFirstName?: string | null
  customerLastName?: string | null
  customerPhone?: string | null
  guestName?: string | null
  guestPhone?: string | null
  customerNotes?: string | null
  items?: OrderItemLike[]
  payments?: Array<{ gatewayCode?: string; amount?: number | string }>
}

function toNum(v: number | string | null | undefined, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n as number) ? (n as number) : fallback
}

function variantLabel(variant: OrderItemLike['variant']): string {
  if (!variant?.attributeValues?.length) return ''
  const attrs = variant.attributeValues
    .map((av) => av?.attributeValue?.value)
    .filter(Boolean) as string[]
  return attrs.length ? ` (${attrs.join(' / ')})` : ''
}

export function buildReceiptFromPosOrder(
  order: PosOrderLike,
  ctx: ReceiptContext = {},
): ReceiptData {
  const lines: ReceiptLine[] = (order.items || []).map((item, idx) => {
    let name = ''
    let sku: string | undefined

    if (item.combo?.name) {
      name = item.combo.name
    } else if (item.product?.name) {
      name = `${item.product.name}${variantLabel(item.variant)}`
      sku = item.variant?.sku || item.product.sku || undefined
    } else {
      // Fresh-order path: names live in the cart, not the response.
      const cartMatch = ctx.cartItems?.find(
        (c) =>
          c.productId === item.productId &&
          (c.variantId || undefined) === (item.variantId || undefined),
      ) ?? ctx.cartItems?.[idx]
      name = cartMatch?.name || 'Item'
      sku = cartMatch?.sku || undefined
    }

    const price = toNum(item.price)
    const quantity = Math.max(1, Math.round(toNum(item.quantity, 1)))
    return { name, sku, quantity, price, lineTotal: price * quantity }
  })

  const customerName =
    [order.customerFirstName, order.customerLastName]
      .filter(Boolean)
      .join(' ')
      .trim() || order.guestName || undefined
  const customerPhone = order.customerPhone || order.guestPhone || undefined

  return {
    storeName: ctx.storeName || 'EcoMate',
    orderNo: order.displayId || '—',
    createdAt: order.createdAt || new Date().toISOString(),
    cashierName: ctx.cashierName || undefined,
    customerName,
    customerPhone,
    lines,
    subtotal: toNum(order.subtotal),
    discount: toNum(order.discount),
    total: toNum(order.total),
    payments: (order.payments || []).map((p) => ({
      method: p.gatewayCode || 'CASH',
      amount: toNum(p.amount),
    })),
    notes: order.customerNotes || undefined,
  }
}

export function formatReceiptMoney(amount: number): string {
  return `৳${amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatReceiptDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}
