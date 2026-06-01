import { cache } from "react";
import { serverFetch } from "../api-server";
import type { StorefrontConfig } from "./storefront-config";

export const getStorefrontConfigServer = cache(async (): Promise<StorefrontConfig> => {
  return serverFetch<StorefrontConfig>("/system-settings/storefront", {
    next: { revalidate: 300 },
  });
});
