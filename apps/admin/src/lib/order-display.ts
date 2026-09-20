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
