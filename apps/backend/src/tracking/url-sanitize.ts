/**
 * URL sanitization for tracking persistence (privacy P0 fix).
 *
 * Sensitive query parameters — order view tokens (`t`), payment/verification
 * tokens, `key`, `orderId`, `access_token`, etc. — must never persist into
 * long-term tracking stores (TrackingContext, PageView) or reach providers
 * (Meta `event_source_url`, TikTok `context.page.referrer`).
 *
 * Policy (identical in storefront + backend): keep scheme/host/pathname,
 * strip the query string and fragment. Legitimate attribution is unaffected:
 *   - fbp/fbc: captured from cookies and direct `fbclid` param reads, never
 *     from persisted page URLs.
 *   - UTM first-party attribution: captured into dedicated structured fields
 *     (MarketingSession), never derived from persisted page URLs.
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
