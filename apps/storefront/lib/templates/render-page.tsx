import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCmsPageBySlug } from "@/lib/api/cms-pages";
import { pageMetadata } from "@/lib/metadata";
import { preFormattedPages } from "./registry";

export const TEMPLATE_REVALIDATE = 300;

/**
 * Server-side renderer for the fixed-layout "system pages" (careers, about,
 * contact, ...). Reads the matching CmsPage template row, honors its
 * active toggle, and renders the page's own component with the stored config
 * merged over the built-in defaults.
 */
export async function renderPreFormattedPage(key: string) {
  const def = preFormattedPages[key];
  if (!def) notFound();

  const page = await getCmsPageBySlug(def.slug);
  if (page && !page.isActive) notFound();

  const config = page?.config ? { ...def.defaultConfig, ...page.config } : def.defaultConfig;
  const Component = def.component;
  return <Component config={config} />;
}

export async function preFormattedPageMetadata(key: string): Promise<Metadata> {
  const def = preFormattedPages[key];
  if (!def) return pageMetadata("Page Not Found", "The page you are looking for does not exist.");
  const page = await getCmsPageBySlug(def.slug).catch(() => null);
  const title = page?.title || def.title;
  return pageMetadata(title, `${title} — ${def.description}`);
}
