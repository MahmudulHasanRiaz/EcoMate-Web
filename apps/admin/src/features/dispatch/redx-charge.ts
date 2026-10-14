// Task 9(c): RedX charge calculator is a dispatch-time PREVIEW — UI shows
// deliveryCharge + codCharge as non-blocking info, never gates dispatch.
export interface RedxChargePreview {
  deliveryCharge?: unknown
  codCharge?: unknown
}

function isChargeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export function isRedxChargePreview(body: unknown): boolean {
  const b = body as RedxChargePreview | null
  if (!b || typeof b !== 'object') return false
  return isChargeNumber(b.deliveryCharge) && isChargeNumber(b.codCharge)
}

export function formatRedxChargePreview(body: unknown): string {
  const b = (body || {}) as RedxChargePreview
  if (isRedxChargePreview(b)) {
    return `Delivery ৳${b.deliveryCharge} + COD ৳${b.codCharge} (preview only — dispatch not blocked)`
  }
  return 'RedX charge preview unavailable'
}
