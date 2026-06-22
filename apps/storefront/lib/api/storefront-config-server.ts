import { cache } from "react";
import { serverFetch } from "../api-server";
import type { StorefrontConfig } from "./storefront-config";

const DEFAULT_CONFIG: StorefrontConfig = {
  store: { name: "Store", tagline: "", email: "", phone: "", address: "" },
  systems: [],
  currency: { code: "BDT", symbol: "৳" },
  delivery: { charge: 0, freeDeliveryMin: 0 },
  hero: { slides: [], secondaryBanner: '', secondaryBannerAlt: '' },
  social: { facebook: "", instagram: "", youtube: "", whatsapp: "", messengerUsername: "" },
  order: { whatsapp: "", callNumber: "" },
  branding: { storefrontFavicon: "", storefrontOgImage: "", storeLogo: "", adminTitle: "", adminFavicon: "", adminTagline: "" },
  seo: { title: "", description: "", keywords: "" },
  footer: { description: "", copyright: "" },
  about: { text: "" },
  shipping: { info: "" },
  payment: { info: "" },
  meta: { pixelEnabled: false, pixelId: "", purchaseMode: "instant", validatedStatus: "" },
  tiktok: { pixelEnabled: false, pixelCode: "", purchaseMode: "instant", validatedStatus: "" },
  menu: { header: { mode: "include", showAllCategories: false, excludedCategories: [], items: [] }, mobile: { mode: "include", showAllCategories: false, excludedCategories: [], items: [] }, footer: { columns: [] } },
  faq: { items: [] },
  hours: { label: "", details: [] },
  company: { name: "", registration: "", certifications: "", teamSize: "", ceoName: "" },
  checkout: { districtEnabled: true, thanaEnabled: true, districtRequired: false, thanaRequired: false, paymentOptions: { FULL_PAYMENT: true, PARTIAL_PAYMENT: true, CASH_ON_DELIVERY: true } },
  districtCharges: {},
  shippingMode: 'options',
  shippingOptions: [],
  shippingZones: [],
  features: { sizeChart: false, hideOosFromArchive: false, maintenanceMode: false, defaultVariantSelected: true, showReviews: true },
  homepageSections: [
    { id: '1', title: 'Featured Gadgets', type: 'featured', limit: 4, enabled: true },
    { id: '2', title: 'New Arrivals', type: 'new_arrivals', limit: 4, enabled: true },
    { id: '3', title: 'Popular Items', type: 'popular', limit: 4, enabled: true },
  ],
};

export const getStorefrontConfigServer = cache(async (): Promise<StorefrontConfig> => {
  try {
    return await serverFetch<StorefrontConfig>("/system-settings/storefront", {
      next: { revalidate: 300 },
    });
  } catch (err) {
    console.error("Failed to fetch storefront config from backend:", err);
    return DEFAULT_CONFIG;
  }
});
