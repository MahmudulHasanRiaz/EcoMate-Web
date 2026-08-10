/**
 * Canonical event-time contract shared by every provider adapter (design §4.2).
 *
 * The canonical snapshot carries eventTime as unix SECONDS (BigInt in the DB,
 * number on the payload). Each provider serializes it differently:
 *  - Meta CAPI:  integer unix seconds (`event_time`)
 *  - TikTok v1.3 pixel/track: ISO 8601 string (`timestamp`) — a JSON number is
 *    rejected with `40002 Invalid value for timestamp: not a valid string.`
 *  - GA4 MP:     microseconds since epoch (`timestamp_micros`)
 *
 * Adapters MUST serialize through these helpers — never inline Date math — so a
 * contract fix (e.g. the TikTok ISO-8601 requirement) lives in exactly one place
 * and is covered by one test suite.
 */

/** Resolve a valid unix-seconds event time; malformed/absent falls back to now. */
export function resolveEventTimeSeconds(eventTime?: number): number {
  if (typeof eventTime === 'number' && Number.isFinite(eventTime) && eventTime > 0) {
    return Math.floor(eventTime);
  }
  return Math.floor(Date.now() / 1000);
}

/** Meta CAPI `event_time` — integer unix seconds. */
export function toMetaEventTime(eventTime?: number): number {
  return resolveEventTimeSeconds(eventTime);
}

/** TikTok v1.3 `timestamp` — ISO 8601 UTC string (rejects JSON numbers). */
export function toTikTokTimestamp(eventTime?: number): string {
  return new Date(resolveEventTimeSeconds(eventTime) * 1000).toISOString();
}

/** GA4 Measurement Protocol `timestamp_micros` — microseconds since epoch. */
export function toGa4Micros(eventTime?: number): number {
  return resolveEventTimeSeconds(eventTime) * 1_000_000;
}
