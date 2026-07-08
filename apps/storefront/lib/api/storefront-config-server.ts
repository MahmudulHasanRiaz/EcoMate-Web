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

export const getStorefrontConfigServer = cache(async (): Promise<StorefrontConfig> => {
  const config = await serverFetch<StorefrontConfig>("/system-settings/storefront", {
    cache: 'no-store',
  });

  if (!config || !config.store?.name) {
    throw new StorefrontConfigError('Storefront config is empty or invalid');
  }

  const categories = await getCategoriesServer();
  const categoryMap = new Map(categories.map((c: any) => [c.id, c]));

  const enrichMenuItemsWithSlug = (items: any[]) => {
    for (const item of items) {
      if (item.type === 'category' && item.categoryId && !item.slug) {
        const cat = categoryMap.get(item.categoryId);
        if (cat?.slug) item.slug = cat.slug;
      }
      if (item.children?.length) enrichMenuItemsWithSlug(item.children);
    }
  };

  if (config?.menu) {
    enrichMenuItemsWithSlug(config.menu.header?.items || []);
    enrichMenuItemsWithSlug(config.menu.mobile?.items || []);
    for (const col of config.menu.footer?.columns || []) {
      enrichMenuItemsWithSlug(col.items || []);
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

  try {
    const licenseRes = await fetch(`${API_URL}/license/status`, {
      cache: 'no-store',
    });
    const licenseStatus = await licenseRes.json();
    config.licenseFeatures = licenseStatus.features || [];
  } catch {
    config.licenseFeatures = [];
  }

  return config;
});
