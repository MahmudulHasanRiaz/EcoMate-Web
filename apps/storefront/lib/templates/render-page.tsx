import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCmsPageBySlug } from "@/lib/api/cms-pages";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { pageMetadata } from "@/lib/metadata";
import { preFormattedPages, templateHasRealContent } from "./registry";
import type { PageMeta } from "./content-utils";

export { templateHasRealContent } from "./registry";

export const TEMPLATE_REVALIDATE = 300;

/**
 * Server-side renderer for the fixed-layout "system pages" (careers, about,
 * contact, ...). Reads the matching CmsPage template row, honors its
 * active toggle, and renders the page's own component with the stored config
 * merged over the built-in (tenant-neutral, empty) defaults.
 *
 * Two response-only enrichments ride along — neither is stored on the row:
 * `storeName` (real store settings; templates must never hardcode a brand
 * name) and `pageMeta` (updatedAt / effectiveDate / version, the single
 * source for the "Last updated" line). Both are optional props: templates
 * that predate them keep working.
 *
 * A third enrichment is the LIVE delivery charge / free-delivery minimum
 * from the storefront config (`delivery.charge` / `delivery.freeDeliveryMin`
 * — the same values checkout uses). The shipping-policy template prefers
 * these over its legacy per-page CMS config values, so the policy can never
 * again disagree with checkout (the old Free-vs-৳60 contradiction). The
 * CMS values remain as fallback when the live config is unconfigured (0).
 */
export async function renderPreFormattedPage(key: string) {
  const def = preFormattedPages[key];
  if (!def) notFound();

  const page = await getCmsPageBySlug(def.slug);
  if (page && !page.isActive) notFound();

  const config = page?.config ? { ...def.defaultConfig, ...page.config } : def.defaultConfig;
  const storefrontConfig = await getStorefrontConfigServer().catch(() => null);
  const storeName = storefrontConfig?.store?.name || "";
  const deliveryCharge = storefrontConfig?.delivery?.charge ?? 0;
  const freeDeliveryMin = storefrontConfig?.delivery?.freeDeliveryMin ?? 0;
  const pageMeta: PageMeta = {
    updatedAt: page?.updatedAt,
    effectiveDate: page?.effectiveDate ?? null,
    version: page?.version,
  };
  const Component = def.component;
  return <Component config={config} storeName={storeName} pageMeta={pageMeta} deliveryCharge={deliveryCharge} freeDeliveryMin={freeDeliveryMin} />;
}

export async function preFormattedPageMetadata(key: string): Promise<Metadata> {
  const def = preFormattedPages[key];
  if (!def) return pageMetadata("Page Not Found", "The page you are looking for does not exist.");
  const page = await getCmsPageBySlug(def.slug).catch(() => null);
  const title = page?.title || def.title;
  const description = page?.metaDescription || `${title} — ${def.description}`;
  const meta = await pageMetadata(title, description, undefined, page?.ogImage || undefined);
  // D8: a content-less template page carries `noindex` even when the
  // indexing flag is ON — otherwise it is omitted from the sitemap but
  // still served indexable. The merged config (defaults + stored row) is
  // exactly what renderPreFormattedPage passes to the template. (The four
  // routes that already add this themselves — delivery-areas, download,
  // faq, support — now redundantly re-add the identical field; harmless.)
  const merged = def
    ? { ...def.defaultConfig, ...(page?.config || {}) }
    : page?.config;
  if (!templateHasRealContent(key, merged)) {
    return { ...meta, robots: { index: false, follow: true } };
  }
  return meta;
}
