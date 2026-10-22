/**
 * Asia/Dhaka (UTC+6, no DST) helpers for the admin UI.
 *
 * Business dates (expense dates, purchase order dates, "today" presets) must
 * be stamped with the Dhaka calendar day, not the browser's UTC-offset day.
 * The offset is fixed (+6h) — Bangladesh has no daylight saving.
 */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

/** "YYYY-MM-DD" of today in Asia/Dhaka. */
export function dhakaTodayString(): string {
  return new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/** "YYYY-MM-DD" of `d` in Asia/Dhaka. */
export function toDhakaDateString(d: Date): string {
  return new Date(d.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * As `toDhakaDateString`, but null-preserving for pickers that can be cleared.
 * A cleared date must stay NULL — "no end date" is a real configuration, not an
 * empty string — so callers that round-trip a nullable value use this.
 */
export function toDhakaDateStringOrNull(d: Date | null | undefined): string | null {
  if (!d) return null
  return toDhakaDateString(d)
}

/** Dhaka midnight of `d` (the UTC instant whose Dhaka date is d). */
export function startOfDhakaDay(d: Date = new Date()): Date {
  const s = new Date(d.getTime() + DHAKA_OFFSET_MS)
  s.setUTCHours(0, 0, 0, 0)
  return new Date(s.getTime() - DHAKA_OFFSET_MS)
}

/** End of the Dhaka day containing `d` — 23:59:59.999 Dhaka. */
export function endOfDhakaDay(d: Date = new Date()): Date {
  return new Date(startOfDhakaDay(d).getTime() + 24 * 60 * 60 * 1000 - 1)
}

/**
 * Inverse of `toDhakaDateString`: turn a "YYYY-MM-DD" Dhaka calendar day back
 * into a Date positioned at Dhaka midnight, ready for a date picker.
 *
 * Parsing with `new Date('2026-11-01')` would give UTC midnight, which is 06:00
 * in Dhaka — the picker would then show the previous day for the value the
 * operator chose. Anchoring to Dhaka midnight keeps the round-trip exact.
 *
 * Returns undefined for null/undefined/empty so callers can pass it straight
 * into a picker expecting `Date | undefined`.
 */
export function parseDhakaDateString(s: string | null | undefined): Date | undefined {
  if (!s) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - DHAKA_OFFSET_MS)
}

const DATE_ONLY_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}

/**
 * Render a date-only value (an ISO instant or a "YYYY-MM-DD" string) as the
 * Dhaka calendar day it names.
 *
 * HR date-only columns are stored as the UTC-midnight instant equal to the
 * Dhaka calendar day. Formatting such a value with the host timezone slides it
 * back a day in any browser west of UTC, and a UTC-pinned format slides it back
 * for the local-midnight instants older rows hold. Pinning Asia/Dhaka renders
 * the business day identically on every host — the admin app's business day is
 * Dhaka (fixed UTC+6, no DST).
 */
export function formatDhakaDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', DATE_ONLY_OPTS)
}