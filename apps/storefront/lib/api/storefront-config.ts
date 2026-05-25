import apiClient from "../api-client";

export interface StorefrontConfig {
  store: {
    name: string;
    tagline: string;
    email: string;
    phone: string;
    address: string;
  };
  currency: {
    code: string;
    symbol: string;
  };
  delivery: {
    charge: number;
    freeDeliveryMin: number;
  };
  hero: {
    slides: { image: string; link?: string }[];
  };
  social: {
    facebook: string;
    instagram: string;
    youtube: string;
    whatsapp: string;
  };
  seo: {
    title: string;
    description: string;
    keywords: string;
  };
  footer: {
    description: string;
    copyright: string;
  };
  about: {
    text: string;
  };
  shipping: {
    info: string;
  };
  payment: {
    info: string;
  };
  meta: {
    pixelEnabled: boolean;
    pixelId: string;
  };
  tiktok: {
    pixelEnabled: boolean;
    pixelCode: string;
  };
}

let cachedConfig: StorefrontConfig | null = null;
let fetchPromise: Promise<StorefrontConfig> | null = null;

export async function getStorefrontConfig(): Promise<StorefrontConfig> {
  if (cachedConfig) return cachedConfig;
  if (fetchPromise) return fetchPromise;
  fetchPromise = apiClient.get<StorefrontConfig>("/system-settings/storefront")
    .then(({ data }) => {
      cachedConfig = data;
      return data;
    });
  const config = await fetchPromise;
  fetchPromise = null;
  return config;
}

export function clearConfigCache() {
  cachedConfig = null;
}
