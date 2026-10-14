// Task 9(a): Pathao bulk is ACCEPTED/async — UI must say
// "accepted, processing", never "created"/"dispatched".
export interface PathaoBulkResult {
  accepted?: boolean
  message?: string
  count?: number
  results?: { id: string; ok: boolean; accepted?: boolean; message?: string }[]
}

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
    return `${count} order(s) accepted, processing — verify via order info after completion`
  }
  return 'Pathao bulk dispatch failed'
}
