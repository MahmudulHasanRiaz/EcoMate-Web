import { truncateGraphemes } from '../orders/order-recipient';

/**
 * Task 10 — settlement hardening shared guard (owner-locked).
 *
 * (1) approval_pending NEVER settles: anything ending `_approval_pending`
 * (+ `exceptional`) is the rider's word, not ours — never a DELIVERED
 * dispatch, never a Delivered advancement, never a settlement/expected/COD
 * effect. `partial_delivered_approval_pending` keeps its T5-locked PARTIAL
 * dispatch mapping (webhook), but it is still unsettled for money purposes
 * (no settlement booking, no COD-alert, expectedCod 0).
 *
 * (2) Truncation/strip: Steadfast doc limits — invoice 100, name 100,
 * phone 40, address 490, note 480 — applied per-courier where docs state,
 * else noted at the call site. `{ } ; < > $` → space before length check.
 *
 * (3) Sync comparisons tolerate server-cut text: normalize (trim + cut to
 * the field max + lowercase) before compare on consignment/invoice matching.
 */

/** Steadfast doc limits (owner decision §settlement extras). */
export const COURIER_FIELD_LIMITS = {
  invoice: 100,
  name: 100,
  phone: 40,
  address: 490,
  note: 480,
} as const;

/** True for statuses that must NEVER settle (owner-locked). */
export function isUnsettledCourierStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'exceptional') return true;
  return s.endsWith('_approval_pending');
}

/**
 * Strip `{ } ; < > $` → space, trim, then truncate to `max` graphemes
 * (never splits a combining mark / ZWJ sequence).
 */
export function sanitizeCourierText(value: string | null | undefined, max: number): string {
  const raw = String(value ?? '');
  const stripped = raw.replace(/[{}\;<>$]/g, ' ');
  const trimmed = stripped.trim();
  if (trimmed.length <= max) {
    // Fast path is only valid for BMP text; fall back to grapheme cut when
    // the naive length exceeds max OR the string is non-ASCII.
    if (/^[\x00-\x7F]*$/.test(trimmed)) return trimmed;
  }
  return truncateGraphemes(trimmed, max);
}

/**
 * Normalize a consignment/invoice identifier for comparison: trim, cut to
 * `max` (default invoice 100 — the courier silently truncates longer values
 * server-side), lowercase. Both sides of every match MUST go through this
 * so a server-cut value still matches our stored full value.
 */
export function normalizeCourierKey(value: string | null | undefined, max = COURIER_FIELD_LIMITS.invoice): string {
  return String(value ?? '').trim().slice(0, max).toLowerCase();
}

/**
 * Invoice comparison without case folding (Order.displayId is
 * case-sensitive): trim + cut to the invoice max so a server-truncated
 * invoice still matches the stored full value at the documented fallback
 * sites (webhook finders). Callers keep the exact query first; the cut form
 * is the documented second step.
 */
export function normalizeInvoiceForCompare(value: string | null | undefined): string {
  return String(value ?? '').trim().slice(0, COURIER_FIELD_LIMITS.invoice);
}
