/**
 * Order display helpers: prefer immutable order-time customer snapshot over
 * mutable CustomerProfile relation. This ensures historical order data is
 * never affected by later CustomerProfile mutations.
 */

interface OrderCustomerSnapshot {
  customerFirstName?: string | null
  customerLastName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  customerCity?: string | null
  customerState?: string | null
  customerZip?: string | null
  customerCountry?: string | null
  guestName?: string | null
  guestPhone?: string | null
  customer?: {
    name?: string | null
    email?: string | null
    phone?: string | null
    firstName?: string | null
    lastName?: string | null
  } | null
  shippingAddress?: {
    name?: string
    phone?: string
    city?: string
    district?: string
    state?: string
    division?: string
    zip?: string
    country?: string
  } | null
}

/**
 * Resolve customer display name from order-time snapshot.
 * Priority: snapshot name > guestName > CustomerProfile name
 */
export function getCustomerDisplayName(order: OrderCustomerSnapshot): string {
  const first = order.customerFirstName || ''
  const last = order.customerLastName || ''
  const full = `${first} ${last}`.trim()
  if (full) return full
  if (order.guestName) return order.guestName
  if (order.customer?.name) return order.customer.name
  return 'Guest'
}

/**
 * Resolve customer phone from order-time snapshot.
 * Priority: snapshot phone > guestPhone > CustomerProfile phone
 */
export function getCustomerPhone(order: OrderCustomerSnapshot): string {
  return order.customerPhone || order.guestPhone || order.customer?.phone || ''
}

/**
 * Resolve customer email from order-time snapshot.
 * Priority: snapshot email > CustomerProfile email
 */
export function getCustomerEmail(order: OrderCustomerSnapshot): string {
  return order.customerEmail || order.customer?.email || ''
}

/**
 * Resolve customer city from order-time snapshot.
 * Priority: snapshot city > shippingAddress city/district
 */
export function getCustomerCity(order: OrderCustomerSnapshot): string {
  if (order.customerCity) return order.customerCity
  const addr = order.shippingAddress
  if (addr) return addr.city || addr.district || ''
  return ''
}

/**
 * Resolve customer state from order-time snapshot.
 * Priority: snapshot state > shippingAddress state/division
 */
export function getCustomerState(order: OrderCustomerSnapshot): string {
  if (order.customerState) return order.customerState
  const addr = order.shippingAddress
  if (addr) return addr.state || addr.division || ''
  return ''
}

/**
 * Resolve customer zip from order-time snapshot.
 * Priority: snapshot zip > shippingAddress zip
 */
export function getCustomerZip(order: OrderCustomerSnapshot): string {
  if (order.customerZip) return order.customerZip
  const addr = order.shippingAddress
  if (addr) return addr.zip || ''
  return ''
}

/**
 * Resolve customer country from order-time snapshot.
 * Priority: snapshot country > shippingAddress country > 'BD'
 */
export function getCustomerCountry(order: OrderCustomerSnapshot): string {
  if (order.customerCountry) return order.customerCountry
  const addr = order.shippingAddress
  if (addr?.country) return addr.country
  return 'BD'
}

/**
 * If the input is a scanned storefront tracking URL (e.g. https://…/orders/ORD-260930-0001 or ?id=ORD-…),
 * extract just the clean order identifier.
 * Safe for direct typing, barcode scanner input, and 2D QR code scanner input.
 */
export function extractOrderScanCode(raw: string): string {
  const trimmed = (raw || '').trim()
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      const queryId =
        url.searchParams.get('id') ||
        url.searchParams.get('displayId') ||
        url.searchParams.get('orderId') ||
        url.searchParams.get('order')
      if (queryId) return queryId.trim()

      const segments = url.pathname.split('/').filter(Boolean)
      const last = segments[segments.length - 1]
      if (last && last.toLowerCase() !== 'orders') return last
    }
  } catch {
    // Not a valid URL — return trimmed
  }
  return trimmed
}

export interface OrderPaymentSummarySource {
  total?: number | string | null
  paymentStatus?: string | null
  paymentOptionType?: string | null
  partialAmount?: number | string | null
  payments?: Array<{
    amount?: number | string | null
    status?: string | null
  }> | null
}

/**
 * Calculate the verified / paid amount on an order.
 * The payment LEDGER is truth: when recorded payment rows exist, their signed
 * sum (PAID-family statuses, negatives included for corrections/refunds) wins
 * over the stored `paymentStatus` column. The column is kept for query/filter
 * only. Falls back to the legacy stored-value heuristics when no rows exist.
 */
export function getOrderPaidAmount(order: OrderPaymentSummarySource | null | undefined): number {
  if (!order) return 0
  const total = Number(order.total || 0)
  if (Array.isArray(order.payments) && order.payments.length > 0) {
    return order.payments
      .filter((p) => {
        const s = (p.status || '').toLowerCase()
        return s === 'paid' || s === 'verified' || s === 'completed'
      })
      .reduce((sum, p) => sum + Number(p.amount || 0), 0)
  }
  if (order.paymentStatus === 'PAID' || order.paymentOptionType === 'FULL_PAYMENT') {
    return total
  }
  if (order.paymentOptionType === 'PARTIAL_PAYMENT' && order.partialAmount) {
    return Number(order.partialAmount)
  }
  return 0
}

/**
 * Calculate the actual remaining due amount (amount collectable on delivery / COD).
 * Guarantees due = max(0, total - paid). Ledger-first: recorded rows decide,
 * stored `paymentStatus` is only a fallback when no rows exist.
 */
export function getOrderDueAmount(order: OrderPaymentSummarySource | null | undefined): number {
  if (!order) return 0
  const total = Number(order.total || 0)
  if (Array.isArray(order.payments) && order.payments.length > 0) {
    return Math.max(0, total - getOrderPaidAmount(order))
  }
  if (order.paymentStatus === 'PAID' || order.paymentOptionType === 'FULL_PAYMENT') {
    return 0
  }
  const paid = getOrderPaidAmount(order)
  return Math.max(0, total - paid)
}

/** Derived payment mode — the single source of truth for payment badges/cards. */
export type OrderPaymentMode = 'Unpaid' | 'Partial' | 'Paid' | 'Credit'

/** Round to paisa so float dust (0.1+0.2) never flips a boundary. */
const toPaisa = (v: number | string): number => Math.round(Number(v || 0) * 100) / 100

/**
 * Pure mode from amounts. Boundary: paid > total → 'Credit' (overrides Paid);
 * paid == total → 'Paid'; 0 < paid < total → 'Partial'; paid <= 0 → 'Unpaid'.
 * Number() coercion handles Decimal-serialized strings.
 */
export function getPaymentModeForAmounts(
  total: number | string,
  paidTotal: number | string,
): OrderPaymentMode {
  const t = toPaisa(total)
  const p = toPaisa(paidTotal)
  if (p <= 0) return 'Unpaid'
  if (p < t) return 'Partial'
  if (p === t) return 'Paid'
  return 'Credit'
}

/**
 * Derived payment mode for an order — computed from the ledger sum, never
 * from the stored `paymentStatus` column directly.
 */
export function getOrderPaymentMode(order: OrderPaymentSummarySource | null | undefined): OrderPaymentMode {
  if (!order) return 'Unpaid'
  return getPaymentModeForAmounts(order.total ?? 0, getOrderPaidAmount(order))
}
