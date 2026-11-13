/**
 * Sitemap route table for the 13 template pages (D8). The real-content
 * rule itself lives in Part A's `templateHasRealContent` (exported from
 * `@/lib/templates/registry`, re-exported by render-page) — this file
 * holds only the slug → path/priority mapping the sitemap needs.
 *
 * NOTE on delivery-areas: Part A's helper only sees CMS config
 * (`areas[]`), but the delivery-areas page is now rendered from the
 * REAL shipping config, so a tenant with zones configured and an empty
 * CMS row still has a full page. Call sites OR the helper result with
 * `hasRealShippingConfig` (see sitemap.ts and the delivery-areas route
 * wrapper) — the helper itself is sync over CMS config and cannot see
 * the shipping config.
 */

/** Template pages that appear in the sitemap when they have real content. */
export interface TemplatePageRoute {
  key: string;
  slug: string;
  path: string;
  changeFrequency: 'monthly';
  priority: number;
}

export const TEMPLATE_PAGE_ROUTES: TemplatePageRoute[] = [
  { key: 'about', slug: 'about', path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  { key: 'company', slug: 'company', path: '/company', changeFrequency: 'monthly', priority: 0.5 },
  { key: 'faq', slug: 'faq', path: '/faq', changeFrequency: 'monthly', priority: 0.5 },
  { key: 'privacy-policy', slug: 'privacy-policy', path: '/privacy-policy', changeFrequency: 'monthly', priority: 0.3 },
  { key: 'terms-conditions', slug: 'terms-conditions', path: '/terms-conditions', changeFrequency: 'monthly', priority: 0.3 },
  { key: 'shipping-policy', slug: 'shipping-policy', path: '/shipping-policy', changeFrequency: 'monthly', priority: 0.3 },
  { key: 'refund-policy', slug: 'refund-policy', path: '/refund-policy', changeFrequency: 'monthly', priority: 0.3 },
  { key: 'exchange-policy', slug: 'exchange-policy', path: '/exchange-policy', changeFrequency: 'monthly', priority: 0.3 },
  { key: 'delivery-areas', slug: 'delivery-areas', path: '/delivery-areas', changeFrequency: 'monthly', priority: 0.4 },
  { key: 'stores', slug: 'stores', path: '/stores', changeFrequency: 'monthly', priority: 0.4 },
  { key: 'contact', slug: 'support', path: '/support', changeFrequency: 'monthly', priority: 0.4 },
  { key: 'careers', slug: 'careers', path: '/careers', changeFrequency: 'monthly', priority: 0.4 },
  { key: 'download', slug: 'download', path: '/download', changeFrequency: 'monthly', priority: 0.4 },
];

/**
 * Whether the live shipping config carries anything the delivery-areas
 * page can show (zones, district charges, options, or a non-zero
 * default charge). Takes the raw public storefront-config payload.
 */
export function hasRealShippingConfig(cfg: any): boolean {
  if (!cfg || typeof cfg !== 'object') return false;
  if (Array.isArray(cfg.shippingZones) && cfg.shippingZones.length > 0) return true;
  if (cfg.districtCharges && typeof cfg.districtCharges === 'object' && Object.keys(cfg.districtCharges).length > 0) return true;
  if (Array.isArray(cfg.shippingOptions) && cfg.shippingOptions.length > 0) return true;
  return Number(cfg.delivery?.charge) > 0;
}
