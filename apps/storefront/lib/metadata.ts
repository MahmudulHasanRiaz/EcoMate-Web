import type { Metadata } from "next";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

export async function pageMetadata(title: string, description?: string): Promise<Metadata> {
  try {
    const config = await getStorefrontConfigServer();
    return {
      title: `${title} — ${config.store.name}`,
      description: description
        ? description.replace(/\{store\}/g, config.store.name)
        : `${title} — ${config.store.name}`,
    };
  } catch {
    return { title, description: description || title };
  }
}
