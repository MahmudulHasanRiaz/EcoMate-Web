import type { Metadata } from "next";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

export async function pageMetadata(title: string, description?: string, path?: string, ogImage?: string): Promise<Metadata> {
  try {
    const config = await getStorefrontConfigServer();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://example.com';
    const fullTitle = `${title} — ${config.store.name}`;
    const desc = description
      ? description.replace(/\{store\}/g, config.store.name)
      : fullTitle;
    return {
      title: fullTitle,
      description: desc,
      ...(path ? { alternates: { canonical: `${baseUrl}${path}` } } : {}),
      ...(ogImage ? {
        openGraph: {
          title: fullTitle,
          description: desc,
          images: [{ url: ogImage }],
        },
        twitter: {
          card: "summary_large_image",
          title: fullTitle,
          description: desc,
          images: [ogImage],
        },
      } : {}),
    };
  } catch {
    return { title, description: description || title };
  }
}
