/**
 * The admin SPA is served under this basepath (see `basepath` in main.tsx —
 * it imports this constant, so there is exactly one source of truth).
 *
 * Router-aware navigation (<Link>, useNavigate) applies the basepath
 * automatically, but RAW anchors (<a href>) and window.open() bypass the
 * router entirely: an app-relative path like `/mon/analytics/products`
 * navigates to a 404. Every raw target must pass through appHref() —
 * the D8 fix for the analytics drill-link 404s, where a whole feature's
 * hand-built hrefs missed the prefix while its tests (mounted without a
 * basepath) stayed green.
 */
export const APP_BASEPATH = '/admin'

/** Prefix an app-relative path ("/op/orders?...") for use in a raw anchor or window.open(). */
export function appHref(path: string): string {
  if (!path.startsWith('/')) return path
  if (path === APP_BASEPATH || path.startsWith(`${APP_BASEPATH}/`)) return path
  return `${APP_BASEPATH}${path}`
}
