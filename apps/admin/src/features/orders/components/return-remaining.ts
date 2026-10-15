interface OrderLineLike {
  id: string
  productId?: string | null
  variantId?: string | null
  quantity?: number | string | null
}

interface ReturnLike {
  items?: { productId?: string | null; variantId?: string | null; quantity?: number | string | null }[] | null
}

const keyOf = (productId: string, variantId?: string | null) =>
  `${productId}::${variantId ?? ''}`

const num = (v: number | string | null | undefined) => Math.max(0, Math.floor(Number(v ?? 0) || 0))

/**
 * Per-order-line return caps: max = ordered − already-returned.
 *
 * `activeReturns` must already be scoped to ACTIVE (non-CLOSED) returns for
 * the order — mirroring the backend assertReturnEligible overlap rule:
 * rows with an unknown split (empty items, e.g. courier legs) contribute 0
 * and never block. A shared product+variant key is distributed greedily in
 * line order. Floors at zero per line.
 */
export function remainingByOrderItem(
  orderItems: OrderLineLike[] | null | undefined,
  activeReturns: ReturnLike[] | null | undefined,
): Record<string, number> {
  const lines = (orderItems ?? []).filter((l) => l?.productId && l?.id)
  const orderedByKey = new Map<string, number>()
  for (const l of lines) {
    const key = keyOf(String(l.productId), (l.variantId ?? null) as string | null)
    orderedByKey.set(key, (orderedByKey.get(key) ?? 0) + num(l.quantity))
  }
  const returnedByKey = new Map<string, number>()
  for (const r of activeReturns ?? []) {
    for (const it of r?.items ?? []) {
      if (!it?.productId) continue
      const key = keyOf(String(it.productId), (it.variantId ?? null) as string | null)
      returnedByKey.set(key, (returnedByKey.get(key) ?? 0) + num(it.quantity))
    }
  }
  const leftByKey = new Map<string, number>()
  for (const [key, ordered] of orderedByKey) {
    leftByKey.set(key, Math.max(0, ordered - (returnedByKey.get(key) ?? 0)))
  }
  const out: Record<string, number> = {}
  for (const l of lines) {
    const key = keyOf(String(l.productId), (l.variantId ?? null) as string | null)
    const left = leftByKey.get(key) ?? 0
    const cap = Math.min(num(l.quantity), left)
    out[l.id] = cap
    leftByKey.set(key, left - cap)
  }
  return out
}
