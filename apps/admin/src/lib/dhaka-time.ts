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