/**
 * URL sanitization for tracking (privacy P0 fix) — mirrors the backend
 * `sanitizeTrackingUrl` policy exactly: keep scheme/host/pathname, strip the
 * query string and fragment before any URL leaves the browser for tracking
 * endpoints (context sync, mirror) or long-term tracking stores.
 *
 * Sensitive query params (order view tokens `t`, `token`, `key`, `orderId`,
 * `access_token`, …) never reach Meta `event_source_url` or TrackingContext.
 *
 * Attribution is unaffected:
 *   - fbp/fbc: read from cookies + direct `fbclid` param reads (never from the
 *     persisted page URL).
 *   - UTM first-party attribution: captured separately into structured fields
 *     (LandingAttribution → MarketingSession), never derived from page URLs.
 */

const MAX_URL_LENGTH = 2048;

export function sanitizeTrackingUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().slice(0, MAX_URL_LENGTH);
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    // Relative path or non-URL value: drop query + fragment manually.
    const clean = trimmed.split(/[?#]/)[0];
    return clean || undefined;
  }
}
