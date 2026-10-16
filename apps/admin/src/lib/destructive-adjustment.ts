/**
 * 100%-removal guard wiring (Fix 3). The server refuses a deduction that
 * would remove (nearly) all available stock with
 * `{ code: 'DESTRUCTIVE_ADJUSTMENT', message }` — match the CODE, never the
 * English message text (it is human copy and may change).
 */
export const DESTRUCTIVE_ADJUSTMENT_CODE = 'DESTRUCTIVE_ADJUSTMENT'

/** Confirm copy shown when the guard fires. */
export const DESTRUCTIVE_CONFIRM_MESSAGE =
  'This removes the last remaining unit(s) at this location — stock will reach zero. Confirm?'

/** True when `err` is the server's destructive-adjustment refusal. */
export function isDestructiveAdjustmentError(err: unknown): boolean {
  return (
    (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data
      ?.code === DESTRUCTIVE_ADJUSTMENT_CODE
  )
}
