import { apiClient } from '@/lib/api-client'

export interface ExchangeListItem {
  id: string
  displayId: string
  kind: string
  status: { id: string; name: string }
  exchangeOfOrderId?: string | null
  exchangeOfOrder?: { id: string; displayId: string } | null
  /** Exchange scope decided at creation (FULL/PARTIAL); null = unknown. */
  exchangeScope?: string | null
  dispatches?: { id: string; courier: string; status: string; consignmentId?: string | null }[]
  courierService?: string | null
  courierConsignmentId?: string | null
  createdAt: string
}

export interface ExchangesListResponse {
  data: ExchangeListItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

/** Full vs Partial exchange mode, derived from the linked Return leg. */
export type ExchangeType = 'Full' | 'Partial' | '—'

/**
 * Structurally loose order line — the shared order-detail payload can carry
 * manual/legacy lines without a productId and string quantities.
 */
export interface ExchangeTypeItem {
  productId?: string | null
  variantId?: string | null
  quantity?: number | string | null
}

/**
 * Derive Full vs Partial from the Return(EXCHANGE) leg vs the original
 * order lines. FULL = the return carries every original line at full
 * quantity; anything less (subset lines or short quantities) = Partial.
 * Original lines without a productId cannot be matched and are skipped; a
 * return line without one can never be confirmed, so it is Partial.
 * Unknown (no return leg yet) renders as '—', never guessed.
 */
export function deriveExchangeType(
  originalItems: ExchangeTypeItem[],
  returnItems: ExchangeTypeItem[] | null | undefined,
): ExchangeType {
  if (!returnItems || returnItems.length === 0) return '—'
  if (!originalItems || originalItems.length === 0) return '—'
  const ordered = new Map<string, number>()
  for (const l of originalItems) {
    if (!l?.productId) continue
    const k = `${l.productId}::${l.variantId ?? ''}`
    ordered.set(k, (ordered.get(k) ?? 0) + Number(l.quantity ?? 0))
  }
  if (ordered.size === 0) return '—'
  for (const l of returnItems) {
    const k = `${l.productId}::${l.variantId ?? ''}`
    const want = ordered.get(k)
    if (want === undefined) return 'Partial'
    if (Number(l.quantity) < want) return 'Partial'
    ordered.delete(k)
  }
  return ordered.size === 0 ? 'Full' : 'Partial'
}

/**
 * Exchanges are EXCHANGE-kind orders (backend default list excludes RETURN,
 * so kind=EXCHANGE isolates them). Linked Return status resolves via
 * GET /returns?exchangeOrderId= (one row per exchange).
 */
export const exchangesApi = {
  list: (q: {
    search?: string
    statusId?: string
    /** Server-side exchange scope filter (FULL/PARTIAL). */
    type?: string
    dateFrom?: string
    dateTo?: string
    page?: number
    perPage?: number
    sort?: string
    order?: string
  } = {}) =>
    apiClient
      .get<ExchangesListResponse>('/orders', { params: { ...q, kind: 'EXCHANGE' } })
      .then((r) => r.data),
  linkedReturn: (exchangeOrderId: string) =>
    apiClient
      .get<{ data: { id: string; displayId: string; status: string }[] }>(
        '/returns',
        { params: { exchangeOrderId } },
      )
      .then((r) => r.data.data[0] ?? null),
}
