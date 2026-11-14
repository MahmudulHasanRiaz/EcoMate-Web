import { headers } from 'next/headers';

// Canonical public origin of THIS storefront.
// Priority: NEXT_PUBLIC_STOREFRONT_URL (docker-compose sets it per client
// from CLIENT_DOMAIN) → NEXT_PUBLIC_BASE_URL (legacy) → '' (relative
// output). Never throws; callers that REQUIRE an absolute URL add their own
// placeholder fallback (existing repo convention: https://example.com).
//
// NOTE on build-time inlining: NEXT_PUBLIC_* vars are baked into the image
// at build time — the CI build passes no build-args, so the GHCR image
// carries siteUrl() === '' and no compose env can ever fix it at runtime.
// The request-host canonical below (canonicalSiteUrl) is therefore the
// runtime source of truth; the env vars are only a fallback, and only when
// they parse as a public https:// URL with no port.
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_STOREFRONT_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    ''
  ).replace(/\/$/, '');
}

// The env origin, accepted ONLY when it parses as a public https:// URL
// with no port. A wrong value (http://, :3001, internal host, example.com)
// is rejected outright — trusting it blindly is how the sitemap ended up
// at http://www.demo.ecomate.bd:3001. Sync: for contexts with no request
// (root-layout metadataBase — headers() there would opt every route into
// dynamic rendering; see canonicalSiteUrl below).
export function envSiteUrl(): string {
  for (const raw of [
    process.env.NEXT_PUBLIC_STOREFRONT_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
  ]) {
    const origin = (raw || '').replace(/\/$/, '');
    if (origin && isPublicHttpsOrigin(origin)) return origin;
  }
  return '';
}

// Build-time placeholder ONLY. It is never a real origin: any caller that
// can see a request must use canonicalSiteUrl() instead, and ISR/dynamic
// callers replace it on first runtime revalidation.
export const BUILD_ORIGIN_PLACEHOLDER = 'https://example.com';

function isPublicHttpsOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    if (u.port) return false;
    if (!u.hostname || u.hostname === 'example.com') return false;
    if (u.username || u.password) return false;
    if (isInternalHost(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// Origin derived from one request host header. The public origin never
// serves on a non-standard port, so a port on a public host (e.g. an
// internal :3001 leaking through a proxy) is dropped; localhost keeps its
// port (dev runs on :3000). Returns null for a malformed/hostile host.
function hostOrigin(host: string): string | null {
  const h = host.trim();
  if (!h) return null;
  // No userinfo, path, query, or whitespace — a bare host[:port].
  if (/[\s/@?#]/.test(h)) return null;
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h);
  if (isLocal) return `http://${h}`;
  const hostname = h.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!/^[a-z0-9._-]+$/i.test(hostname) || hostname.includes('..')) return null;
  if (isInternalHost(hostname)) return null;
  return `https://${hostname}`;
}

// Canonical public origin for crawler-facing surfaces (sitemap, robots,
// canonical alternates). Derives the origin from the REQUEST host at
// runtime — x-forwarded-host first (the proxy sets it from the real host),
// then host — https unless the host is localhost. Falls back to the env
// var only when it parses as a public https:// URL with no port, and never
// emits https://example.com at runtime: the placeholder is returned only
// when there is no request context at all (build-time prerender).
//
// headers() is a request-time API: calling it opts the route into dynamic
// rendering. That is correct for sitemap/robots (already dynamic/ISR) and
// for page-level generateMetadata — but it must NOT be called from the
// root layout's generateMetadata, where it would make every route in the
// app dynamic. The root layout uses envSiteUrl() instead (deferred:
// metadataBase can only become request-derived if the app accepts
// dynamic-everything or the image is built with the env set).
export async function canonicalSiteUrl(): Promise<string> {
  try {
    const hdrs = await headers();
    // NOTE: x-forwarded-host is client-controllable; the deployment proxy
    // is expected to overwrite it with the real host (verify in the nginx
    // config). A spoofed value can only poison a response the attacker
    // requests themselves — sitemap/robots are cached per URL, so confirm
    // the proxy overwrites it before relying on the cache.
    const forwarded = hdrs.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwarded || hdrs.get('host')?.trim();
    if (host) {
      const origin = hostOrigin(host);
      if (origin) return origin;
    }
  } catch {
    // No request context (build-time prerender) — fall through.
  }
  const env = envSiteUrl();
  if (env) return env;
  return BUILD_ORIGIN_PLACEHOLDER;
}

// Backend / Docker-internal hostnames that must never leak into public
// metadata — crawlers can't resolve them (prod API_URL=http://backend:4000).
function isInternalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'backend' || h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  const m = h.match(/^172\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

// Resolve any product-media src to a crawler-safe absolute URL:
// - relative (/uploads/x) → site origin + path (untouched when site unset)
// - absolute on an internal host → same path on the site origin
//   (/uploads is rewritten to the backend publicly, so the path stays valid)
// - absolute public (CDN / shop domain) → untouched
export function publicMediaUrl(src: string | undefined): string | undefined {
  if (!src) return undefined;
  const site = siteUrl();
  if (/^https?:\/\//i.test(src)) {
    if (!site) return src;
    try {
      const u = new URL(src);
      if (isInternalHost(u.hostname)) return `${site}${u.pathname}${u.search}`;
    } catch {
      // malformed absolute URL — pass through rather than break the page
    }
    return src;
  }
  if (!site) return src;
  return `${site}${src.startsWith('/') ? '' : '/'}${src}`;
}
