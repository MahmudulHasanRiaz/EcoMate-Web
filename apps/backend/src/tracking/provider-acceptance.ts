/**
 * Provider acceptance, bounded by actual evidence.
 *
 * The system must never claim Meta/TikTok/Google received and processed an
 * event unless the provider's own response says so. "Our HTTP call returned
 * 200" is evidence of an accepted REQUEST, not of a processed event, and the
 * two are reported as different states.
 *
 *   accepted      — the provider positively confirmed this event (business-level).
 *   rejected      — the provider responded with a definitive negative for it.
 *   http_accepted — the transport succeeded but no per-event verdict was
 *                   available. Never rendered as "Delivered".
 *   unknown       — no usable evidence at all (never sent, or unparseable).
 */

export type AcceptanceState = 'accepted' | 'rejected' | 'http_accepted' | 'unknown';

/** The strongest claim a provider's response can support. Drives the column header. */
export const ACCEPTANCE_LABEL: Record<AcceptanceState, string> = {
  accepted: 'Provider accepted',
  rejected: 'Rejected',
  http_accepted: 'HTTP accepted',
  unknown: 'Unknown',
};

export interface DispatchEvidence {
  status: string;
  httpStatus?: number | null;
  responseBody?: string | null;
  errorMsg?: string | null;
  attemptCount: number;
}

/** Providers whose response carries a machine-readable business verdict. */
const BUSINESS_CODE_PROVIDERS = new Set(['tiktok']);

function parseBody(responseBody?: string | null): any | null {
  if (!responseBody) return null;
  try {
    return JSON.parse(responseBody);
  } catch {
    return null;
  }
}

/**
 * Meta's Conversions API answers HTTP 200 even when an individual event is
 * rejected, reporting the failure inside `events[].errors`. That array is
 * already persisted in responseBody, so a real per-event verdict is derivable
 * without a new ledger. Absent errors array => no per-event rejection reported.
 */
function metaVerdict(body: any): AcceptanceState | null {
  const events = body?.events;
  if (!Array.isArray(events) || events.length === 0) return null;
  const rejected = events.some(
    (e: any) => Array.isArray(e?.errors) && e.errors.length > 0,
  );
  return rejected ? 'rejected' : 'accepted';
}

/** TikTok's Events API returns a top-level `code`; 0 is the only success. */
function tiktokVerdict(body: any): AcceptanceState | null {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.code === 'number') return body.code === 0 ? 'accepted' : 'rejected';
  if (body.message === 'OK' || body.status === 0) return 'accepted';
  return null;
}

export function acceptanceFor(provider: string, dispatch: DispatchEvidence): AcceptanceState {
  // No outbound attempt was ever made: nothing to have been accepted.
  if (dispatch.attemptCount <= 0) return 'unknown';
  if (dispatch.status === 'SKIPPED' || dispatch.status === 'DEDUPED') return 'unknown';

  // Terminal failure is a definitive non-acceptance regardless of body.
  if (dispatch.status === 'FAILED' || dispatch.status === 'DEAD') return 'rejected';

  const body = parseBody(dispatch.responseBody);
  const p = (provider || '').toLowerCase();

  if (p === 'meta' || p === 'facebook') {
    const verdict = metaVerdict(body);
    if (verdict) return verdict;
    // 200 with no parsable per-event detail: request accepted, event unconfirmed.
    return dispatch.status === 'SENT' ? 'http_accepted' : 'unknown';
  }

  if (BUSINESS_CODE_PROVIDERS.has(p)) {
    const verdict = tiktokVerdict(body);
    if (verdict) return verdict;
    return dispatch.status === 'SENT' ? 'http_accepted' : 'unknown';
  }

  // GA4, Google Ads, and any future adapter: transport-level evidence only.
  return dispatch.status === 'SENT' ? 'http_accepted' : 'unknown';
}

/**
 * Column header for the metrics table, chosen as the strongest claim any row in
 * the set actually evidences. A table where every provider gave a business
 * verdict can say "Provider accepted"; one that only got 200s must say
 * "HTTP accepted". It can never say "Delivered".
 */
export function acceptanceColumnLabel(states: AcceptanceState[]): string {
  if (states.length === 0) return 'Provider accepted';
  if (states.every((s) => s === 'accepted' || s === 'rejected' || s === 'unknown')) {
    return 'Provider accepted';
  }
  return 'HTTP accepted';
}
