import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";
import { getCmsPageBySlug } from "@/lib/api/cms-pages";
import { templateHasRealContent, preFormattedPages } from "@/lib/templates/registry";
import { hasRealShippingConfig } from "@/lib/template-content";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

export const revalidate = 300;

export async function generateMetadata() {
  const meta = await preFormattedPageMetadata("delivery-areas");
  // D8: a content-less template page carries `noindex` even when the
  // indexing flag is ON.
  const page = await getCmsPageBySlug("delivery-areas").catch(() => null);
  const def = preFormattedPages["delivery-areas"];
  const merged = def ? { ...def.defaultConfig, ...(page?.config || {}) } : page?.config;
  // Part A's helper only sees CMS config; this page's content comes from
  // the live shipping config, so it counts too.
  const shipping = await getStorefrontConfigServer().catch(() => null);
  const hasContent =
    templateHasRealContent("delivery-areas", merged) ||
    hasRealShippingConfig(shipping);
  if (!hasContent) {
    return { ...meta, robots: { index: false, follow: true } };
  }
  return meta;
}

export default async function DeliveryAreasPage() {
  return renderPreFormattedPage("delivery-areas");
}
