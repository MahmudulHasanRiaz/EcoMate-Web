import type { Metadata } from "next";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { canonicalSiteUrl } from "@/lib/site-url";

// Page metadata helper. Returns the BARE title — the root layout's
// title.template (`%s — {store name}`) appends the store name exactly once.
// (Returning `${title} — ${store name}` here duplicated it: "Careers —
// E-Demo Store — E-Demo Store".)
export async function pageMetadata(title: string, description?: string, path?: string, ogImage?: string): Promise<Metadata> {
  try {
    const config = await getStorefrontConfigServer();
    const baseUrl = await canonicalSiteUrl();
    const desc = description
      ? description.replace(/\{store\}/g, config.store.name)
      : title;
    return {
      title,
      description: desc,
      ...(path ? { alternates: { canonical: `${baseUrl}${path}` } } : {}),
      ...(ogImage ? {
        openGraph: {
          title,
          description: desc,
          images: [{ url: ogImage }],
        },
        twitter: {
          card: "summary_large_image",
          title,
          description: desc,
          images: [ogImage],
        },
      } : {}),
    };
  } catch {
    return { title, description: description || title };
  }
}
