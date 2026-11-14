import { canonicalSiteUrl } from './site-url';
import { getStorefrontConfigServer } from './api/storefront-config-server';

/** Store display name for metadata (falls back when config is unreachable). */
export async function getMetaStoreName(): Promise<string> {
  try {
    return (await getStorefrontConfigServer()).store.name;
  } catch {
    return 'EcoMate';
  }
}

/**
 * Site origin without trailing slash for canonical URLs. Async: the
 * request-derived chain (Settings domain → request host → env) — a
 * sync env value can never be the runtime truth for a shared image.
 */
export async function metaBaseUrl(): Promise<string> {
  return canonicalSiteUrl();
}

/** 'wedding-wear' → 'Wedding Wear' (used when no display name resolves). */
export function prettySlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
