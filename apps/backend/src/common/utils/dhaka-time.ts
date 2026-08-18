/**
 * Asia/Dhaka (UTC+6, no DST) date helpers.
 *
 * Bangladesh has no daylight saving, so the offset is a fixed +6h. All helpers
 * are pure Date arithmetic — no tz database needed. Business-day boundaries
 * ("today", day-stamped IDs, date-only query params) MUST go through these so
 * they align with the Dhaka business day instead of the server's UTC clock.
 */
export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Current instant, as the UTC Date instance representing Dhaka-now wall clock. */
export function dhakaNow(): Date {
  return new Date(Date.now() + DHAKA_OFFSET_MS);
}

/** Start of the Dhaka day containing `d` (or now), as an absolute UTC Date. */
export function startOfDhakaDay(d: Date = new Date()): Date {
  const shifted = new Date(d.getTime() + DHAKA_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - DHAKA_OFFSET_MS);
}

/** End of the Dhaka day containing `d` (or now) — 23:59:59.999 Dhaka. */
export function endOfDhakaDay(d: Date = new Date()): Date {
  const start = startOfDhakaDay(d);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** "YYYY-MM-DD" of the Dhaka day containing `d` (or now). */
export function dhakaDateString(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + DHAKA_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Dhaka date components (year, month 1-12, day) of `d` (or now). */
export function dhakaDateParts(d: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(d.getTime() + DHAKA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Interpret a date-only string ("YYYY-MM-DD") as a Dhaka calendar day and
 * return the absolute UTC instants [start, end) of that day. Strings with a
 * time component ('T') pass through as an exact instant.
 */
export function dhakaDayRange(
  dateStr: string,
): { start: Date | null; end: Date | null } {
  if (!dateStr) return { start: null, end: null };
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return { start: d, end: d };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    const d = new Date(dateStr);
    return { start: d, end: d };
  }
  const [, y, m, day] = match;
  // 1970-01-01T00:00:00Z + offset = 06:00Z — the Dhaka midnight anchor.
  const start = new Date(Date.UTC(Number(y), Number(m) - 1, Number(day)) - DHAKA_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/**
 * Truncate an instant to its Dhaka-day bucket (used to key/aggregate
 * day-level series). Returns a UTC Date at 00:00 Dhaka.
 */
export function dhakaDayBucket(d: Date): Date {
  return startOfDhakaDay(d);
}

/**
 * Truncate an instant to its Dhaka hour bucket. Returns a UTC Date at
 * HH:00 Dhaka.
 */
export function dhakaHourBucket(d: Date): Date {
  const shifted = new Date(d.getTime() + DHAKA_OFFSET_MS);
  shifted.setUTCMinutes(0, 0, 0);
  return new Date(shifted.getTime() - DHAKA_OFFSET_MS);
}

/** "YYYY-MM-DD" key of the Dhaka day containing instant `d`. */
export function dhakaDayKey(d: Date): string {
  return dhakaDateString(d);
}