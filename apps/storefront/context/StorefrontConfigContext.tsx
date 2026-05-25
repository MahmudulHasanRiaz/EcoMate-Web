"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { getStorefrontConfig, StorefrontConfig } from "@/lib/api/storefront-config";

const DEFAULT_CONFIG: StorefrontConfig = {
  store: { name: "Store", tagline: "", email: "", phone: "", address: "" },
  currency: { code: "BDT", symbol: "৳" },
  delivery: { charge: 0, freeDeliveryMin: 0 },
  hero: { slides: [] },
  social: { facebook: "", instagram: "", youtube: "", whatsapp: "" },
  seo: { title: "", description: "", keywords: "" },
  footer: { description: "", copyright: "" },
  about: { text: "" },
  shipping: { info: "" },
  payment: { info: "" },
  meta: { pixelEnabled: false, pixelId: "" },
  tiktok: { pixelEnabled: false, pixelCode: "" },
};

interface StorefrontConfigContextType {
  config: StorefrontConfig;
  isLoading: boolean;
  refresh: () => void;
}

const StorefrontConfigContext = createContext<StorefrontConfigContextType>({
  config: DEFAULT_CONFIG,
  isLoading: true,
  refresh: () => {},
});

export function StorefrontConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<StorefrontConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(() => {
    setIsLoading(true);
    getStorefrontConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <StorefrontConfigContext.Provider value={{ config, isLoading, refresh }}>
      {children}
    </StorefrontConfigContext.Provider>
  );
}

export function useStorefrontConfig() {
  return useContext(StorefrontConfigContext);
}
