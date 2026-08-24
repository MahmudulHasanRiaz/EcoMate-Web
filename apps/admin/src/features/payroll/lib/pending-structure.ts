import { startOfDhakaDay } from '@/lib/dhaka-time'

/**
 * G-31 — when the LATEST salary structure is future-dated (effectiveFrom >
 * the Dhaka business day), it has not started yet. The UI shows an amber
 * "New structure starts {date}" chip on the history card while the current
 * active structure stays displayed.
 *
 * `structures` must be ordered by effectiveFrom descending (history endpoint
 * contract), so index 0 is the newest window.
 */
export function pendingEffectiveFrom(
  structures: { effectiveFrom: string }[],
  now: Date = new Date(),
): string | undefined {
  const latest = structures[0]
  if (!latest) return undefined
  const today = startOfDhakaDay(now).getTime()
  return new Date(latest.effectiveFrom).getTime() > today ? latest.effectiveFrom : undefined
}
