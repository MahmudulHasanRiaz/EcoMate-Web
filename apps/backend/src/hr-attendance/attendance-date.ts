/**
 * Asia/Dhaka business-date helpers for the attendance domain.
 *
 * AttendanceDay.date is stored as the UTC-midnight equal to the Dhaka calendar
 * date ("stored convention"): the string 2026-08-25 maps to the instant
 * 2026-08-25T00:00:00.000Z, and the Dhaka day "today" is derived from the
 * Asia/Dhaka wall clock (UTC+6, no DST) — never from the server's UTC clock.
 */
export const DHAKA_TZ = 'Asia/Dhaka';

/** "YYYY-MM-DD" of the Dhaka calendar day containing the instant `now`. */
export function dhakaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Dhaka business-date string of an instant (event could be near midnight). */
export function dhakaDateOf(d: Date): string {
  return dhakaToday(d);
}

/**
 * Validate + normalize a date-only string to the UTC-midnight instant equal to
 * the Dhaka calendar date (the stored convention). Rejects malformed values.
 */
export function parseLocalDate(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!match) {
    throw new Error(`Invalid date '${dateStr}'`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(y, m - 1, day));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== m - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date '${dateStr}'`);
  }
  return d;
}

/** Start of the Dhaka calendar day (stored-convention UTC midnight). */
export function dhakaStartOfDay(dateStr: string): Date {
  return parseLocalDate(dateStr);
}

/** [today, today+1d) as stored-convention instants (upper bound exclusive). */
export function dhakaRangeForToday(now: Date = new Date()): {
  from: Date;
  to: Date;
} {
  const from = dhakaStartOfDay(dhakaToday(now));
  return { from, to: new Date(from.getTime() + 86400000) };
}
