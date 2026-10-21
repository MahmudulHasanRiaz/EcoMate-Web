/**
 * Packing scan routing — the boundary between the ORDER step and the ITEM
 * (product verification) step.
 *
 * Incident (2026-10-21, production phone): the order QR was decoded ~10x per
 * second. The order step consumed it, but the camera session deliberately
 * survives the order → item transition, so the SAME value kept arriving at
 * the item step and produced an endless stream of "Wrong Product!" toasts
 * (10–15/s, stacking over each other).
 *
 * The rules that stop it:
 *  1. an order reference (an ORD-/RTN- id, or a storefront order URL) that
 *     reaches the item step is IGNORED SILENTLY — it is a leak from the
 *     order step, never a wrong-SKU error;
 *  2. the order step consumes its value exactly once (the shared camera
 *     session emits a value once and re-arms only after the value leaves the
 *     view);
 *  3. the mismatch toast is gated per value and uses ONE stable toast id, so
 *     a burst can never stack a Toaster backlog.
 */

/** Order/return identifiers the packing screens understand. */
const ORDER_REF_RE = /^(ORD|RTN)-\d{6}-\d{4}$/i

/**
 * The order identifier inside a scanned value, or null when the value is not
 * an order reference. Handles plain ids AND storefront order URLs
 * (`https://www.avelto.bd/orders/ORD-261021-0023`, `?id=ORD-…`).
 */
export function extractOrderReference(raw: string): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (ORDER_REF_RE.test(value)) return value.toUpperCase()
  if (!/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    const candidates = [
      url.searchParams.get('id'),
      url.searchParams.get('displayId'),
      url.searchParams.get('orderId'),
      url.searchParams.get('order'),
      ...url.pathname.split('/').filter(Boolean),
    ]
    for (const candidate of candidates) {
      const hit = (candidate ?? '').trim().match(ORDER_REF_RE)
      if (hit) return hit[0].toUpperCase()
    }
  } catch {
    /* not a URL — not an order reference */
  }
  return null
}

/** Is this scanned value an order reference (id or order URL)? */
export function isOrderReference(raw: string): boolean {
  return extractOrderReference(raw) !== null
}

export interface PackingScanDeps {
  /** An order is open → the scanned value is a PRODUCT barcode. */
  orderOpen: boolean
  /** The order step: open the order for this identifier. */
  onOrder: (code: string) => void | Promise<void>
  /** The item step: verify one unit of this product barcode. */
  onProduct: (code: string) => void | Promise<void>
}

/**
 * Route one decoded value to the order step or the item step.
 *
 * Returns the promise of the handler it called (or undefined when the value
 * was ignored), so the camera session can hold its processing lock until the
 * work settles.
 */
export function routePackingScan(
  raw: string,
  deps: PackingScanDeps,
): void | Promise<void> {
  const value = (raw ?? '').trim()
  if (!value) return
  if (!deps.orderOpen) {
    // Order step: a plain id or an order URL both resolve to the order id.
    return deps.onOrder(extractOrderReference(value) ?? value)
  }
  if (isOrderReference(value)) {
    // LEAK from the order step — ignored silently, never a wrong-SKU error.
    return
  }
  return deps.onProduct(value)
}

/**
 * Toast gate: the same wrong value may toast at most once per window, and a
 * different value always gets its own notice. Used with a STABLE toast id so
 * a repeat updates the notice in place instead of stacking a backlog.
 */
export function createMismatchToastGate(windowMs = 4000) {
  let last: { value: string; at: number } | null = null
  return {
    shouldToast(value: string, now: number): boolean {
      if (last && last.value === value && now - last.at < windowMs) return false
      last = { value, at: now }
      return true
    },
    /** Called when a new arm cycle starts (the value left the view). */
    reset(): void {
      last = null
    },
  }
}
