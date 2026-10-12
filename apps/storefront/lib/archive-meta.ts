import { siteUrl } from './site-url';
import { getStorefrontConfigServer } from './api/storefront-config-server';

/** Store display name for metadata (falls back when config is unreachable). */
export async function getMetaStoreName(): Promise<string> {
  try {
    return (await getStorefrontConfigServer()).store.name;
  } catch {
    return 'Store';
  }
}

/** Site origin without trailing slash for canonical URLs. */
export function metaBaseUrl(): string {
  return siteUrl();
}

/** 'wedding-wear' → 'Wedding Wear' (used when no display name resolves). */
export function prettySlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
