/**
 * Google Maps URL check for StoreLocation.mapUrl.
 *
 * The owner-specified way a location is shared is a Google Maps link, so a
 * mapUrl must actually point at Google Maps — never an arbitrary URL.
 * Accepted forms:
 *   - https://maps.app.goo.gl/<short-code> (Google Maps short links)
 *   - https://www.google.com/maps/... and https://maps.google.com/...
 *     (incl. google.com/maps share links and /maps/dir, /maps/place, ...)
 * Anything else (other hosts, plain google.com search links, non-URLs) is
 * rejected so a mistyped/pasted wrong link can never reach the storefront.
 */
export function isGoogleMapsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'maps.google.com') return true;
  if (host === 'google.com' || host.endsWith('.google.com')) {
    return (
      url.pathname === '/maps' || url.pathname.startsWith('/maps/')
    );
  }
  return false;
}
