"use client";

import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

export function StoreName() {
  const { config } = useStorefrontConfig();
  return <>{config.store.name}</>;
}
