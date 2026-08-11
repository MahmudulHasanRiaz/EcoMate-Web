/**
 * Lightweight first-party landing attribution (spec §21).
 *
 * Captures the source context of the FIRST page load in a browser session and
 * persists it through the journey (landing → browse → checkout → order) so the
 * order-create payload can carry legitimate UTM / platform click-id / referrer
 * signals. The storefront only COLLECTS these raw signals — the platform/type
 * resolution lives in one backend resolver (orders/web-attribution), never
 * duplicated client-side.
 *
 * First write wins: the first page load in a tab is treated as the session
 * landing; its URL/query/referrer are the authoritative source context unless
 * a stronger signal arrives later. sessionStorage survives soft navigations
 * and reloads within the tab. Capturing more than this — a clickstream or
 * cross-tab journey — is explicitly out of scope (keep it lightweight).
 */

const KEY = 'ecomate_attribution_v1';
const MAX_LEN = 200;

export interface LandingAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrer?: string;
  fbclid?: string;
  ttclid?: string;
  igshid?: string;
  /** epoch ms of the landing capture — used for debugging/diagnostics only. */
  ts?: number;
}

function clean(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_LEN);
}

function readStored(): LandingAttribution | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LandingAttribution;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(attribution: LandingAttribution): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(attribution));
  } catch {
    // storage unavailable/full — attribution simply does not persist
  }
}

function captureFromWindow(): LandingAttribution | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const params = new URLSearchParams(window.location.search || '');
  return {
    utmSource: clean(params.get('utm_source')),
    utmMedium: clean(params.get('utm_medium')),
    utmCampaign: clean(params.get('utm_campaign')),
    utmContent: clean(params.get('utm_content')),
    utmTerm: clean(params.get('utm_term')),
    referrer: clean(document.referrer),
    fbclid: clean(params.get('fbclid')),
    ttclid: clean(params.get('ttclid')),
    igshid: clean(params.get('igshid')),
    ts: Date.now(),
  };
}

/**
 * Capture the landing attribution for this session — idempotent: the first
 * captured value is kept. Safe to call on every page load / app boot.
 */
export function captureLandingAttribution(): LandingAttribution | null {
  const stored = readStored();
  if (stored) return stored;
  const captured = captureFromWindow();
  if (!captured) return null;
  writeStored(captured);
  return captured;
}

/** Read the session landing attribution (capturing on first call if needed). */
export function getLandingAttribution(): LandingAttribution | null {
  const stored = readStored();
  if (stored) return stored;
  return captureLandingAttribution();
}

/** Clear the captured attribution (e.g. after a successful checkout). */
export function clearLandingAttribution(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}