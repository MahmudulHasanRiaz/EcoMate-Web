// Task 9(a): Pathao bulk is ACCEPTED/async — UI must say
// "accepted — results arrive automatically; check dispatch list", never
// "created"/"dispatched", and never a fake "verify via order info" (the 202
// carries no per-order ids to verify with). The actionable handles are the
// merchant_order_id/displayId entries; the toast action links to the dispatch
// list where the accepted rows sit as "Pending webhook" until the async
// webhooks complete them.
export interface PathaoBulkResultEntry {
  id: string
  merchant_order_id?: string
  displayId?: string
  ok: boolean
  accepted?: boolean
  message?: string
}

export interface PathaoBulkResult {
  accepted?: boolean
  message?: string
  count?: number
  results?: PathaoBulkResultEntry[]
}

/** Toast-action target: the dispatch list shows the accepted rows. */
export const PATHAO_BULK_DISPATCH_LIST_PATH = '/op/dispatch'

export function isPathaoBulkAccepted(body: unknown): boolean {
  const b = body as PathaoBulkResult | null
  if (!b || typeof b !== 'object') return false
  if (b.accepted === true) return true
  return !!(
    b.results &&
    b.results.length > 0 &&
    b.results.every((r) => r.ok && r.accepted)
  )
}

export function formatPathaoBulkToast(body: unknown): string {
  const b = (body || {}) as PathaoBulkResult
  const count = b.count ?? b.results?.length ?? 0
  if (isPathaoBulkAccepted(body)) {
    const handles = (b.results || [])
      .map((r) => r.merchant_order_id || r.displayId)
      .filter(Boolean) as string[]
    const who = handles.length > 0 ? ` (${handles.join(', ')})` : ''
    return `${count} order(s) accepted — results arrive automatically; check dispatch list${who}`
  }
  return 'Pathao bulk dispatch failed'
}
