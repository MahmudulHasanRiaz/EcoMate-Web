import { serverFetch } from "../api-server";
import type { StorefrontConfig } from "./storefront-config";

let cachedConfig: StorefrontConfig | null = null;

export async function getStorefrontConfigServer(): Promise<StorefrontConfig> {
  if (cachedConfig) return cachedConfig;
  const data = await serverFetch<StorefrontConfig>("/system-settings/storefront", {
    next: { revalidate: 300 },
  });
  cachedConfig = data;
  return data;
}

export function clearConfigCache() {
  cachedConfig = null;
}
