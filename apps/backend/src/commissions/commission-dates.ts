/**
 * Dhaka-calendar-day normalisation for commission rule validity windows.
 *
 * Why this exists:
 *
 * A rule's `effectiveFrom` / `effectiveTo` are expressed by operators as
 * calendar days ("start 1 November"), and the commission engine evaluates them
 * against an exact instant — the moment an order was moved into the qualifying
 * status. Storing a bare `new Date('2026-11-01')` would pin that day to
 * 00:00 UTC, which is 06:00 in Dhaka, and would silently stop the rule paying
 * for the first six hours of its own first day (and, symmetrically, stop it
 * paying at all on the day chosen as its last day).
 *
 * So the day is anchored to the Dhaka calendar instead:
 *
 *   effectiveFrom "2026-11-01" -> 2026-11-01T00:00:00+06:00 (start of that day)
 *   effectiveTo   "2026-11-01" -> 2026-11-01T23:59:59.999+06:00 (whole day)
 *
 * Both ends are therefore INCLUSIVE: a rule still pays on the last day it is
 * configured to cover, and begins paying from the first moment of its first day.
 *
 * An input carrying an explicit time ('2026-11-01T10:00:00Z') is already an
 * exact instant chosen deliberately, so it passes through untouched — this
 * normalisation only affects date-only input.
 *
 * NULL is a real, meaningful value and is preserved as NULL: no start date
 * means the rule has always applied; no end date means it applies until it is
 * explicitly ended. Nothing is ever defaulted to "today".
 */
import { DHAKA_OFFSET_MS } from '../common/utils/dhaka-time';

/** True for a bare `YYYY-MM-DD`, as opposed to a full ISO timestamp. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type BoundInput = string | Date | null | undefined;

function isBlank(input: BoundInput): boolean {
  return input === null || input === undefined || input === '';
}

/**
 * Parse a bare `YYYY-MM-DD` as its exact UTC midnight.
 * Returns null for anything that is not date-only (already handled by callers).
 */
function parseDateOnly(input: string): Date | null {
  if (!DATE_ONLY.test(input)) return null;
  const [y, m, d] = input.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  // Reject calendar-invalid dates such as 2026-02-31, which Date.UTC rolls over.
  if (
    utcMidnight.getUTCFullYear() !== y ||
    utcMidnight.getUTCMonth() !== m - 1 ||
    utcMidnight.getUTCDate() !== d
  ) {
    return null;
  }
  return utcMidnight;
}

/**
 * The instant a Dhaka calendar day begins: 00:00:00.000 local Dhaka time.
 *
 * A date-only string is anchored to that moment. A string carrying an explicit
 * time is already an instant the caller chose, so it is preserved exactly.
 */
export function normalizeEffectiveFrom(input?: BoundInput): Date | null {
  if (isBlank(input)) return null;
  if (input instanceof Date) return new Date(input.getTime());

  const raw = String(input);
  const dayStart = parseDateOnly(raw);
  if (dayStart) return new Date(dayStart.getTime() - DHAKA_OFFSET_MS);
  return new Date(raw);
}

/**
 * The instant a Dhaka calendar day ends: 23:59:59.999 local Dhaka time, so the
 * whole day the operator picked remains inside the rule's validity window.
 */
export function normalizeEffectiveTo(input?: BoundInput): Date | null {
  if (isBlank(input)) return null;
  if (input instanceof Date) return new Date(input.getTime());

  const raw = String(input);
  const dayStart = parseDateOnly(raw);
  if (dayStart) return new Date(dayStart.getTime() - DHAKA_OFFSET_MS + 24 * 60 * 60 * 1000 - 1);
  return new Date(raw);
}

/**
 * Render an instant back as the Dhaka calendar day it falls on, as `YYYY-MM-DD`.
 *
 * Responses carry the day the operator actually chose rather than a UTC
 * timestamp, so no consumer has to re-derive the timezone (and cannot get it
 * wrong by slicing an ISO string).
 */
export function toDhakaDateString(value: Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const shifted = new Date(value.getTime() + DHAKA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * True when the two validity windows share at least one instant.
 *
 * A null bound is UNBOUNDED on that side, not "matches everything": a rule that
 * ended on the 10th and a rule that starts on the 15th are genuinely disjoint
 * even though each is open on one side. Treating any null as an automatic
 * overlap would reject that legitimate pair, so a null is resolved to the
 * appropriate infinity and the same inclusive comparison is used for all cases.
 *
 * Both ends are inclusive, matching normalizeEffectiveFrom/To, so two rules
 * whose windows merely touch on a single day DO overlap.
 *
 * Exported so it can be unit-tested directly, without a database.
 */
export function validityWindowsOverlap(
  a: { effectiveFrom: Date | null; effectiveTo: Date | null },
  b: { effectiveFrom: Date | null; effectiveTo: Date | null },
): boolean {
  // Widest and narrowest representable instants, used as the ±infinity bounds.
  const MIN = -8640000000000000;
  const MAX = 8640000000000000;

  const aStart = a.effectiveFrom === null ? MIN : a.effectiveFrom.getTime();
  const aEnd = a.effectiveTo === null ? MAX : a.effectiveTo.getTime();
  const bStart = b.effectiveFrom === null ? MIN : b.effectiveFrom.getTime();
  const bEnd = b.effectiveTo === null ? MAX : b.effectiveTo.getTime();

  // Inclusive intersection: each window starts at or before the other ends.
  return aStart <= bEnd && aEnd >= bStart;
}