import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";
import { getCmsPageBySlug } from "@/lib/api/cms-pages";
import { templateHasRealContent, preFormattedPages } from "@/lib/templates/registry";

export const revalidate = 300;

export async function generateMetadata() {
  const meta = await preFormattedPageMetadata("faq");
  // D8: a content-less template page carries `noindex` even when the
  // indexing flag is ON.
  const page = await getCmsPageBySlug("faq").catch(() => null);
  const def = preFormattedPages["faq"];
  const merged = def ? { ...def.defaultConfig, ...(page?.config || {}) } : page?.config;
  if (!templateHasRealContent("faq", merged)) {
    return { ...meta, robots: { index: false, follow: true } };
  }
  return meta;
}

export default async function FaqPage() {
  return renderPreFormattedPage("faq");
}
