/**
 * Confirm-gate physical-stock failures — Issue 4 of the 2026-11-24
 * inventory cluster investigation.
 *
 * The confirm gate itself is spec-locked and correct: with Inventory
 * Management ON, an order cannot confirm while a line has no (or not
 * enough) physical stock. What was broken was the UX — staff got a bare
 * error toast with no path forward. This helper recognises that failure
 * and resolves WHICH product is short, so the status dialog can point
 * staff straight at the fix (add physical stock for that product).
 *
 * The backend throws a plain BadRequestException with a message only —
 * no stable error code — so detection is message-based, the same
 * approach the order-create flow already uses for 'Insufficient
 * physical stock' (create.tsx). Messages, verbatim from
 * apps/backend/src/orders/orders.service.ts:
 * - English: 'Insufficient physical stock…' — no record / not enough /
 *   'for "<name>"' / 'for combo component "<name>"'
 * - Bengali (MANAGED_STOCK branch): '"<name>" এর Physical Inventory-তে
 *   কোনো Stock রেকর্ড নেই…' / '"<name>" এর Physical Stock অপর্যাপ্ত…'
 *
 * Deliberately NOT matched: the managed-only shortage
 * ('Insufficient stock for "<name>"…', no 'physical') — adding managed
 * stock is a different path and must not offer the physical-stock fix.
 */

export interface PhysicalStockOrderLine {
  productId?: string | null
  variantId?: string | null
  isManual?: boolean
  product?: { id?: string; name?: string } | null
}

export interface PhysicalStockConfirmError {
  /** Verbatim backend reason, shown to staff as-is. */
  message: string
  /** Product named in the error, when the backend names one. */
  productName?: string
  /** Order-line product, when the named product matches an order line. */
  productId?: string
  /** Set when the failing line is a variant line. */
  variantId?: string | null
}

const PHYSICAL_STOCK_PATTERNS = [
  /insufficient physical stock/i,
  /physical inventory-তে কোনো stock রেকর্ড নেই/i,
  /physical stock অপর্যাপ্ত/i,
]

export function isPhysicalStockConfirmError(message: string): boolean {
  if (!message) return false
  return PHYSICAL_STOCK_PATTERNS.some((re) => re.test(message))
}

function quotedProductName(message: string): string | undefined {
  const m = message.match(/"([^"]+)"/)
  return m?.[1]?.trim() || undefined
}

function findLine(
  items: PhysicalStockOrderLine[],
  name: string,
): PhysicalStockOrderLine | undefined {
  return (
    items.find((i) => i.product?.name === name) ||
    items.find((i) => i.product?.name?.toLowerCase() === name.toLowerCase())
  )
}

/**
 * Recognise a confirm-gate physical-stock failure and, when possible,
 * resolve it to the order line that is short. Returns null for any other
 * error. When the backend names a product that is not an order line
 * (e.g. a combo component), productName is still returned but productId
 * is left unset — the dialog then offers the purchase path instead of a
 * deep link to the wrong product.
 */
export function resolvePhysicalStockConfirmError(
  message: string,
  items: PhysicalStockOrderLine[] = [],
): PhysicalStockConfirmError | null {
  if (!isPhysicalStockConfirmError(message)) return null
  const result: PhysicalStockConfirmError = { message }
  const name = quotedProductName(message)
  if (name) {
    result.productName = name
    const line = findLine(items, name)
    if (line) {
      result.productId = line.product?.id || line.productId || undefined
      result.variantId = line.variantId ?? null
    }
    return result
  }
  // No product named (e.g. 'Insufficient physical stock. No physical
  // inventory record found.'): unambiguous only for a single product line.
  const productLines = items.filter(
    (i) => !i.isManual && (i.productId || i.product?.id),
  )
  if (productLines.length === 1) {
    const line = productLines[0]
    result.productId = line.product?.id || line.productId || undefined
    result.productName = line.product?.name
    result.variantId = line.variantId ?? null
  }
  return result
}
