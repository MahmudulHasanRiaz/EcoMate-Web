import { cache } from "react";
import { serverFetch } from "../api-server";
import type { StorefrontConfig } from "./storefront-config";
import { getCategoriesServer } from "./products-server";

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
    const config = await serverFetch<StorefrontConfig>("/system-settings/storefront", {
      next: { revalidate: 300 },
    });

    if (config?.menu) {
      const headerShowAll = config.menu.header?.showAllCategories;
      const mobileShowAll = config.menu.mobile?.showAllCategories;

      if (headerShowAll || mobileShowAll) {
        const categories = await getCategoriesServer();
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
          const menuNodesByCatId = new Map<string, any>();
          
          const walkMenu = (items: any[]) => {
            for (const item of items) {
              if (item.type === 'category' && item.categoryId) {
                existingCatIds.add(item.categoryId);
                menuNodesByCatId.set(item.categoryId, item);
              }
              if (item.children) walkMenu(item.children);
            }
          };
          walkMenu(itemsClone);

          const excludedIds = new Set(section.excludedCategories || []);
          const categoriesToInject = shownCategories.filter(c => !excludedIds.has(c.id) && !existingCatIds.has(c.id));
          
          const injectedNodesByCatId = new Map<string, any>();
          categoriesToInject.forEach(c => {
            injectedNodesByCatId.set(c.id, {
              id: `cat-${c.id}`,
              type: 'category',
              label: c.name,
              categoryId: c.id,
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

    return config;
  } catch (err) {
    console.error("Failed to fetch storefront config from backend:", err);
    return DEFAULT_CONFIG;
  }
});
