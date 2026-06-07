"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { getStorefrontConfig, StorefrontConfig } from "@/lib/api/storefront-config";

const DEFAULT_CONFIG: StorefrontConfig = {
  store: { name: "Store", tagline: "", email: "", phone: "", address: "" },
  systems: [],
  currency: { code: "BDT", symbol: "৳" },
  delivery: { charge: 0, freeDeliveryMin: 0 },
  hero: { slides: [], secondaryBanner: '', secondaryBannerAlt: '' },
  social: { facebook: "", instagram: "", youtube: "", whatsapp: "", messengerUsername: "" },
  order: { whatsapp: "", callNumber: "" },
  branding: { storefrontFavicon: "", storefrontOgImage: "", adminTitle: "", adminFavicon: "", adminTagline: "" },
  seo: { title: "", description: "", keywords: "" },
  footer: { description: "", copyright: "" },
  about: { text: "" },
  shipping: { info: "" },
  payment: { info: "" },
  meta: { pixelEnabled: false, pixelId: "" },
  tiktok: { pixelEnabled: false, pixelCode: "" },
  navigation: { items: [] },
  faq: { items: [] },
  hours: { label: "", details: [] },
  company: { name: "", registration: "", certifications: "", teamSize: "", ceoName: "" },
  checkout: { districtEnabled: true, thanaEnabled: true, districtRequired: false, thanaRequired: false, paymentModes: ['cod', 'full', 'partial'] },
  districtCharges: {},
  shippingMode: 'options',
  shippingOptions: [],
  shippingZones: [],
};

function getBootstrappedConfig(): StorefrontConfig | undefined {
  try {
    const el = document.getElementById('__INITIAL_CONFIG__');
    if (el?.textContent) return JSON.parse(el.textContent);
  } catch {}
  return undefined;
}

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

export function StorefrontConfigProvider({ children, initialConfig }: { children: ReactNode; initialConfig?: StorefrontConfig }) {
  const [config, setConfig] = useState<StorefrontConfig>(
    initialConfig || getBootstrappedConfig() || DEFAULT_CONFIG
  );
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(() => {
    setIsLoading(true);
    getStorefrontConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <StorefrontConfigContext.Provider value={{ config, isLoading, refresh }}>
      {children}
    </StorefrontConfigContext.Provider>
  );
}

export function useStorefrontConfig() {
  return useContext(StorefrontConfigContext);
}
