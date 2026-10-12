// Canonical public origin of THIS storefront.
// Priority: NEXT_PUBLIC_STOREFRONT_URL (docker-compose sets it per client
// from CLIENT_DOMAIN) → NEXT_PUBLIC_BASE_URL (legacy) → '' (relative
// output). Never throws; callers that REQUIRE an absolute URL add their own
// placeholder fallback (existing repo convention: https://example.com).
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_STOREFRONT_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    ''
  ).replace(/\/$/, '');
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
