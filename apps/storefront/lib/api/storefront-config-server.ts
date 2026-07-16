import { cache } from "react";
import { serverFetch } from "../api-server";
import type { StorefrontConfig } from "./storefront-config";
import { getCategoriesServer } from "./products-server";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export class StorefrontConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorefrontConfigError';
  }
}

const DEFAULT_CONFIG: StorefrontConfig = {
  store: { name: "Store", tagline: "", email: "", phone: "", address: "" },
  systems: [],
  currency: { code: "BDT", symbol: "৳" },
  delivery: { charge: 0, freeDeliveryMin: 0 },
  hero: { slides: [], secondaryBanner: '', secondaryBannerAlt: '' },
  social: { facebook: "", instagram: "", youtube: "", whatsapp: "", messengerUsername: "" },
  order: { whatsapp: "", callNumber: "" },
  branding: { storefrontFavicon: "", storefrontOgImage: "", storeLogo: "", adminTitle: "", adminFavicon: "", adminTagline: "", colors: { primary: '#0089CD', primaryDark: '#006da3', accent: '#E77250', text: '#0a0a0a', background: '#FFFFFF', success: '#22C55E', danger: '#EF4444', border: '#E5E7EB', shadowSoft: '0 8px 25px rgba(0,137,205,0.15)', shadowStrong: '0 15px 45px -5px rgba(0,137,205,0.6)' } },
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
  checkout: { districtEnabled: true, thanaEnabled: true, districtRequired: false, thanaRequired: false },
  districtCharges: {},
  shippingMode: 'options',
  shippingOptions: [],
  shippingZones: [],
  features: { sizeChart: false, hideOosFromArchive: false, maintenanceMode: false, defaultVariantSelected: true, showReviews: true },
  thankYou: { title: '', subtitle: '', description: '' },
  licenseFeatures: [],
  homepageSections: [],
};

export const getStorefrontConfigServer = cache(async (): Promise<StorefrontConfig> => {
  let config: StorefrontConfig;
  try {
    config = await serverFetch<StorefrontConfig>("/system-settings/storefront", {
      next: { revalidate: 60 },
      timeout: 30000,
    });
  } catch (err) {
    console.warn('[StorefrontConfig] Failed to fetch config — using fallback. Details:', err instanceof Error ? err.message : err);
    return DEFAULT_CONFIG;
  }

  if (!config?.store?.name) {
    return DEFAULT_CONFIG;
  }

  // Merge server config over defaults so missing nested fields never cause crashes
  config = { ...DEFAULT_CONFIG, ...config };

  // Categories and license can be fetched in parallel — both independent of each other
  const [categories, licenseStatus] = await Promise.all([
    getCategoriesServer(),
    fetch(`${API_URL}/license/status`, { next: { revalidate: 300 } })
      .then(r => r.json())
      .catch(() => ({ active: true, features: [], message: '' })),
  ]);

  const categoryMap = new Map(categories.map((c: any) => [c.id, c]));

  const deduplicateItems = (items: any[]): any[] => {
    const seen = new Set<string>();
    const uniqueItems: any[] = [];
    for (const item of items) {
      const key = item.categoryId || item.id || item.url || item.label;
      if (key && !seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }
    return uniqueItems;
  };

  const enrichMenuItemsWithSlug = (items: any[]) => {
    for (const item of items) {
      if (item.type === 'category' && item.categoryId && !item.slug) {
        const cat = categoryMap.get(item.categoryId);
        if (cat?.slug) item.slug = cat.slug;
      }
      if (item.children?.length) {
        const seen = new Set<string>();
        const uniqueChildren: any[] = [];
        for (const child of item.children) {
          const key = child.categoryId || child.id || child.url || child.label;
          if (key && !seen.has(key)) {
            seen.add(key);
            uniqueChildren.push(child);
          }
        }
        item.children = uniqueChildren;
        enrichMenuItemsWithSlug(item.children);
      }
    }
  };

  if (config?.menu) {
    if (config.menu.header?.items) {
      config.menu.header.items = deduplicateItems(config.menu.header.items);
      enrichMenuItemsWithSlug(config.menu.header.items);
    }
    if (config.menu.mobile?.items) {
      config.menu.mobile.items = deduplicateItems(config.menu.mobile.items);
      enrichMenuItemsWithSlug(config.menu.mobile.items);
    }
    for (const col of config.menu.footer?.columns || []) {
      if (col.items) {
        col.items = deduplicateItems(col.items);
        enrichMenuItemsWithSlug(col.items);
      }
    }

    const headerShowAll = config.menu.header?.showAllCategories;
    const mobileShowAll = config.menu.mobile?.showAllCategories;

    if (headerShowAll || mobileShowAll) {
      const shownCategories = categories.filter((c: any) => c.showInMenu !== false);

      const cloneItems = (items: any[]): any[] => {
        return items.map(item => ({
          ...item,
          children: item.children ? cloneItems(item.children) : []
        }));
      };

      const injectCategories = (section: any) => {
        if (!section || !section.showAllCategories) return section;

        const itemsClone = cloneItems(section.items || []);

        const existingCatIds = new Set<string>();
        const existingLabels = new Set<string>();
        const menuNodesByCatId = new Map<string, any>();

        const walkMenu = (items: any[]) => {
          for (const item of items) {
            if (item.label) existingLabels.add(item.label.toLowerCase());
            if (item.type === 'category' && item.categoryId) {
              existingCatIds.add(item.categoryId);
              menuNodesByCatId.set(item.categoryId, item);
            }
            if (item.children) walkMenu(item.children);
          }
        };
        walkMenu(itemsClone);

        const excludedIds = new Set(section.excludedCategories || []);
        const categoriesToInject = shownCategories.filter(c => !excludedIds.has(c.id) && !existingCatIds.has(c.id) && !existingLabels.has(c.name.toLowerCase()));

        const injectedNodesByCatId = new Map<string, any>();
        categoriesToInject.forEach(c => {
          injectedNodesByCatId.set(c.id, {
            id: `cat-${c.id}`,
            type: 'category',
            label: c.name,
            categoryId: c.id,
            slug: c.slug ?? null,
            children: []
          });
        });

        const rootInjectedItems: any[] = [];

        categoriesToInject.forEach(c => {
          const node = injectedNodesByCatId.get(c.id);
          if (!node) return;

          if (c.parentId) {
            if (menuNodesByCatId.has(c.parentId)) {
              const parentMenuNode = menuNodesByCatId.get(c.parentId);
              parentMenuNode.children = parentMenuNode.children || [];
              parentMenuNode.children.push(node);
            } else if (injectedNodesByCatId.has(c.parentId)) {
              const parentInjectedNode = injectedNodesByCatId.get(c.parentId);
              parentInjectedNode.children.push(node);
            } else {
              rootInjectedItems.push(node);
            }
          } else {
            rootInjectedItems.push(node);
          }
        });

        return {
          ...section,
          items: [...itemsClone, ...rootInjectedItems]
        };
      };

      if (headerShowAll) config.menu.header = injectCategories(config.menu.header);
      if (mobileShowAll) config.menu.mobile = injectCategories(config.menu.mobile);
    }
  }

  config.licenseFeatures = licenseStatus.features || [];

  // Expose license status on config for root layout (avoids duplicate fetch)
  (config as any)._licenseActive = licenseStatus?.active ?? true;
  (config as any)._licenseMessage = licenseStatus?.message || '';

  return config;
});
