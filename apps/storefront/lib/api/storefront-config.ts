import apiClient from "../api-client";
import type { CatalogImageRatio } from "../utils/image-ratio";

export interface StoreSystem {
  id: string;
  name: string;
  logo: string;
  display: 'name' | 'logo' | 'name+logo';
}

export interface BrandColors {
  primary: string;
  primaryDark: string;
  accent: string;
  text: string;
  background: string;
  success: string;
  danger: string;
  border: string;
  shadowSoft: string;
  shadowStrong: string;
}

export interface StorefrontConfig {
  store: {
    name: string;
    tagline: string;
    email: string;
    phone: string;
    address: string;
  };
  systems: StoreSystem[];
  currency: {
    code: string;
    symbol: string;
  };
  delivery: {
    charge: number;
    freeDeliveryMin: number;
  };
  hero: {
    slides: { image: string; link?: string; alt?: string }[];
    secondaryBanner: string;
    secondaryBannerAlt: string;
  };
  social: {
    facebook: string;
    instagram: string;
    youtube: string;
    whatsapp: string;
    messengerUsername: string;
  };
  order: {
    whatsapp: string;
    callNumber: string;
  };
  branding: {
    storefrontFavicon: string;
    storefrontOgImage: string;
    storeLogo: string;
    adminTitle: string;
    adminFavicon: string;
    adminTagline: string;
    colors: BrandColors;
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
    purchaseMode: 'instant' | 'validated';
    validatedStatus: string;
  };
  tiktok: {
    pixelEnabled: boolean;
    pixelCode: string;
    purchaseMode: 'instant' | 'validated';
    validatedStatus: string;
  };
  menu: {
    header: { mode: string; showAllCategories: boolean; excludedCategories: string[]; items: any[] };
    mobile: { mode: string; showAllCategories: boolean; excludedCategories: string[]; items: any[] };
    footer: { columns: any[] };
  };
  faq: {
    items: { question: string; answer: string }[];
  };
  hours: {
    label: string;
    details: { day: string; time: string }[];
  };
  company: {
    name: string;
    registration: string;
    certifications: string;
    teamSize: string;
    ceoName: string;
  };
  checkout: {
    districtEnabled: boolean;
    thanaEnabled: boolean;
    districtRequired: boolean;
    thanaRequired: boolean;
    paymentOptions?: Record<string, boolean>;
  };
  districtCharges: Record<string, number>;
  shippingMode: 'options' | 'auto_district';
  shippingOptions: { id: string; name: string; amount: number; sortOrder: number }[];
  shippingZones: { id: string; type: 'custom_amount' | 'no_delivery'; amount: number | null; districts: string[]; label: string | null }[];
  catalogImageRatio?: CatalogImageRatio;
  homepageSections?: {
    id: string;
    title: string;
    type: 'featured' | 'new_arrivals' | 'popular' | 'category';
    categoryId?: string;
    categorySort?: 'default' | 'new_arrivals' | 'popular';
    limit: number;
    enabled: boolean;
  }[];
  features: {
    sizeChart: boolean;
    hideOosFromArchive: boolean;
    maintenanceMode: boolean;
    defaultVariantSelected: boolean;
    showReviews: boolean;
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
