import type { MetadataRoute } from 'next';
import { canonicalSiteUrl } from '@/lib/site-url';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

// Robots must be evaluated at request time, never baked at build time:
// the flag lives in the backend and can change without a redeploy.
export const dynamic = 'force-dynamic';

/**
 * Search-engine indexing (D7): ONE flag drives robots + sitemap + layout
 * meta in lockstep.
 * - Flag OFF (explicit `false`): `Disallow: /` for every agent and NO
 *   sitemap reference — crawlers are told to stay out entirely.
 * - Flag ON (or a missing key from a pre-toggle backend): the previous
 *   allow-list behaviour, private pages still disallowed.
 * - Config fetch failure: the server default is fail-closed (OFF), so a
 *   backend outage cannot accidentally invite crawlers onto a degraded
 *   store. During the build-time prerender there is no backend by design;
 *   force-dynamic above means this is rendered per request instead.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = await canonicalSiteUrl();
  const config = await getStorefrontConfigServer().catch(() => null);
  // getStorefrontConfigServer normalises to a clean boolean (explicit
  // `false` only when the tenant stored it; missing key → ON; fetch
  // failure → DEFAULT_CONFIG `false`). Anything else (a throw here) is
  // fail-closed: noindex.
  const indexingEnabled = config?.searchIndexingEnabled === true;

  if (!indexingEnabled) {
    return {
      rules: {
        userAgent: '*',
        disallow: ['/'],
      },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/admin', '/checkout', '/cart', '/orders', '/wishlist'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
