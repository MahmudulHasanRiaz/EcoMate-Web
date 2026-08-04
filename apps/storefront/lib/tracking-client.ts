import { isTrackingAllowed } from './tracking';

const CTX_KEY = 'ecomate_ctx_id';

export function getTrackingApiUrl(): string {
  if (typeof window !== 'undefined' && !window.location.hostname.includes('localhost')) {
    return '/api';
  }
  return (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000/api'
  );
}

export function getOrCreateCtxId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(CTX_KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(CTX_KEY, id);
  }
  return id;
}
export const getCtxId = getOrCreateCtxId;

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

export function collectIdentifiers(): Record<string, Record<string, string>> {
  const ids: Record<string, Record<string, string>> = {};
  const meta: Record<string, string> = {};
  const fbp = getCookie('_fbp'); if (fbp) meta.fbp = fbp;
  const fbc = getCookie('_fbc'); if (fbc) meta.fbc = fbc;
  if (!fbc && typeof location !== 'undefined') {
    const fbclid = new URLSearchParams(location.search).get('fbclid');
    if (fbclid) meta.fbclid = fbclid;
  }
  if (Object.keys(meta).length) ids.meta = meta;
  const tiktok: Record<string, string> = {};
  const ttp = getCookie('_ttp'); if (ttp) tiktok._ttp = ttp;
  if (typeof location !== 'undefined') {
    const ttclid = new URLSearchParams(location.search).get('ttclid');
    if (ttclid) tiktok.ttclid = ttclid;
  }
  if (Object.keys(tiktok).length) ids.tiktok = tiktok;
  const google: Record<string, string> = {};
  const ga = getCookie('_ga'); if (ga) google.gaClientId = ga;
  if (typeof location !== 'undefined') {
    const gclid = new URLSearchParams(location.search).get('gclid');
    if (gclid) google.gclid = gclid;
  }
  if (Object.keys(google).length) ids.google = google;
  return ids;
}

let inflight: Promise<void> | null = null;
export async function syncContext(payload?: {
  identifiers?: Record<string, Record<string, string>>;
  url?: string;
  referrer?: string;
}): Promise<void> {
  if (typeof window === 'undefined') return;
  // Wave-2.3 — consent/opt-out gate: no context POST when tracking is blocked.
  if (!isTrackingAllowed()) return;
  if (inflight) return inflight; // throttle: one at a time
  inflight = (async () => {
    try {
      const url = `${getTrackingApiUrl()}/tracking/context`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ctxId: getOrCreateCtxId(),
          identifiers: payload?.identifiers ?? collectIdentifiers(),
          url: payload?.url ?? location.href,
          referrer: payload?.referrer ?? document.referrer,
        }),
        keepalive: true,
      });
    } catch {
      /* best-effort — never block the page */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
