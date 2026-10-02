/**
 * Shift-derived attendance metrics.
 *
 * Pure functions only — no database, no clock, no service. Given a resolved
 * shift and a day's punches, this returns the numbers. Keeping it pure is what
 * makes the overtime rules testable in isolation and keeps the same maths from
 * drifting between the write path (check-out) and the read path (an open day).
 *
 * Timezone: AttendanceDay.date is the stored convention — UTC-midnight equal to
 * the Dhaka calendar date (see attendance-date.ts). A shift's "09:00" is a
 * Dhaka wall-clock time, so the window is resolved against that same day.
 */

/** The minimum a shift needs for metrics to be derivable. */
export interface DerivableShift {
  /** Dhaka wall clock "HH:mm". */
  startTime: string;
  /** Dhaka wall clock "HH:mm". */
  endTime: string;
  graceMinutes: number;
  breakMinutes: number;
  standardMinutes: number;
  /** endTime < startTime. Persisted explicitly rather than inferred. */
  overnight: boolean;
}

export interface SessionPunch {
  checkInAt: Date;
  /** null while the session is still open — counted to `at`. */
  checkOutAt: Date | null;
}

export interface DayMetrics {
  scheduledMinutes: number | null;
  overtimeMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  outsideShift: boolean;
}

/** All metrics unresolved — the value for any day with no shift in effect. */
export const NO_SHIFT_METRICS: DayMetrics = {
  scheduledMinutes: null,
  overtimeMinutes: null,
  lateMinutes: null,
  earlyLeaveMinutes: null,
  outsideShift: false,
};

/** "HH:mm" → minutes past Dhaka midnight. Throws on a malformed value. */
export function parseWallClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) throw new Error(`Invalid shift time '${value}' (expected HH:mm)`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new Error(`Invalid shift time '${value}'`);
  return h * 60 + m;
}

/** Does this shift cross Dhaka midnight? Derived, used to validate writes. */
export function detectOvernight(startTime: string, endTime: string): boolean {
  return parseWallClock(endTime) < parseWallClock(startTime);
}

/**
 * The shift window as instants bracketing the business day.
 *
 * For an overnight shift the window opens on the business day and closes on the
 * next one, which is how a 22:00–06:00 shift belongs to the day it started.
 */
export function shiftWindowFor(
  day: Date,
  shift: Pick<DerivableShift, 'startTime' | 'endTime' | 'overnight'>,
): { start: Date; end: Date } {
  const base = day.getTime();
  const startMin = parseWallClock(shift.startTime);
  const endMin = parseWallClock(shift.endTime);
  return {
    start: new Date(base + startMin * 60000),
    end: new Date(base + endMin * 60000 + (shift.overnight ? 86400000 : 0)),
  };
}

const minutesBetween = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));

/**
 * Derive one day's shift metrics.
 *
 * Overtime is NET: `worked − scheduled`, floored at zero. Arriving an hour late
 * and leaving an hour late nets out, which is the honest answer — the person
 * did not put in extra hours. A short day therefore never produces overtime.
 *
 * `outsideShift` is true only when work happened with NO overlap with the shift
 * window at all, so routine in-shift overtime and out-of-hours work can never
 * be confused when reading a report.
 */
export function deriveDayMetrics(input: {
  /** Business day (stored convention UTC-midnight). */
  day: Date;
  workedMinutes: number;
  /** null when no shift was assigned — every metric stays unresolved. */
  shift: DerivableShift | null;
  sessions: SessionPunch[];
  /** Instant the numbers are measured at, for a still-open session. */
  at: Date;
}): DayMetrics {
  const { shift } = input;
  if (!shift) return { ...NO_SHIFT_METRICS };

  const { start, end } = shiftWindowFor(input.day, shift);
  const grace = shift.graceMinutes;

  // The day starts at the EARLIEST check-in, not sessions[0] — sessions arrive
  // ordered by checkInAt from the DB, but an adjustment or a machine replay can
  // leave them in another order, and lateness must not depend on that.
  const earliestCheckIn = input.sessions.length
    ? new Date(Math.min(...input.sessions.map((s) => s.checkInAt.getTime())))
    : null;

  // Grace absorbs lateness/early-departure up to the threshold: arriving within
  // the grace window is not late. The surplus past it is what counts.
  const lateMinutes = earliestCheckIn
    ? Math.max(0, minutesBetween(start, earliestCheckIn) - grace)
    : 0;
  // An employee still clocked in has not left early, however far past the shift
// end the current time has run — that only becomes an early departure once the
// session is actually closed.
const allClosed = input.sessions.every((s) => s.checkOutAt !== null);
const earlyLeaveMinutes =
  input.sessions.length && allClosed
    ? Math.max(
        0,
        minutesBetween(
          new Date(
            Math.min(
              end.getTime(),
              ...input.sessions.map((s) => s.checkOutAt!.getTime()),
            ),
          ),
          end,
        ) - grace,
      )
    : 0;

  const outsideShift = input.sessions.some((s) => {
    const sStart = s.checkInAt.getTime();
    const sEnd = (s.checkOutAt ?? input.at).getTime();
    return sEnd <= start.getTime() || sStart >= end.getTime();
  });

  return {
    scheduledMinutes: shift.standardMinutes,
    overtimeMinutes: Math.max(
      0,
      Math.floor(input.workedMinutes - shift.standardMinutes),
    ),
    lateMinutes,
    earlyLeaveMinutes,
    outsideShift,
  };
}