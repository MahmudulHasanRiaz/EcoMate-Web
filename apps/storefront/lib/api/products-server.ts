import { cache } from "react";
import { serverFetch } from "../api-server";
import type { Product, Variant, Category, Review } from "../types";
import { transformBackendProduct } from "./products";
import { getStorefrontConfigServer } from "./storefront-config-server";

export interface ServerProductsResponse {
  data: Product[];
  meta: {
    total: number;
    perPage: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface FetchProductsServerOpts {
  cursor?: string;
  perPage?: number;
  search?: string;
  type?: string;
  categoryId?: string;
  category?: string;
  tagSlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  isActive?: boolean;
  isFeatured?: boolean;
  ids?: string;
  sort?: string;
  order?: string;
  hasStock?: boolean;
}

function buildQuery(params: FetchProductsServerOpts): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.perPage) sp.set("perPage", String(params.perPage));
  if (params.search) sp.set("search", params.search);
  if (params.type) sp.set("type", params.type);
  if (params.categoryId) sp.set("categoryId", params.categoryId);
  if (params.category) sp.set("category", params.category);
  if (params.tagSlug) sp.set("tagSlug", params.tagSlug);
  if (params.brandSlug) sp.set("brandSlug", params.brandSlug);
  if (params.minPrice !== undefined) sp.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== undefined) sp.set("maxPrice", String(params.maxPrice));
  if (params.isActive !== undefined) sp.set("isActive", String(params.isActive));
  if (params.isFeatured !== undefined) sp.set("isFeatured", String(params.isFeatured));
  if (params.ids) sp.set("ids", params.ids);
  if (params.sort) sp.set("sort", params.sort);
  if (params.order) sp.set("order", params.order);
  if (params.hasStock !== undefined) sp.set("hasStock", String(params.hasStock));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const fetchProductsServer = cache(async function fetchProductsServer(
  opts: FetchProductsServerOpts = {},
): Promise<ServerProductsResponse> {
  const url = `/products${buildQuery(opts)}`;
  try {
    // Stock renders on listing cards — never serve from the fetch cache.
    // The backend list endpoint is uncached, so every render is a fresh read.
    // Surge-safe: at most 1 retry with a short timeout on this hot path.
    const data = await serverFetch<any>(url, {
      revalidate: 0,
      maxRetries: 1,
      timeout: 5000,
    });
    return {
      data: (data.data || []).map(transformBackendProduct),
      meta: {
        total: data.meta?.total ?? 0,
        perPage: data.meta?.perPage ?? opts.perPage ?? 24,
        nextCursor: data.meta?.nextCursor ?? null,
        hasMore: Boolean(data.meta?.hasMore),
      },
    };
  } catch (err) {
    console.error(`Failed to fetch products from backend: ${url}`, err);
    return {
      data: [],
      meta: {
        total: 0,
        perPage: opts.perPage ?? 24,
        nextCursor: null,
        hasMore: false,
      },
    };
  }
});

export async function getCategoriesServer(): Promise<Category[]> {
  try {
    const data = await serverFetch<any>("/categories", { revalidate: 300 });
    return Array.isArray(data) ? data : data.data || [];
  } catch (err) {
    console.error("Failed to fetch categories from backend:", err);
    return [];
  }
}

export async function getBrandsServer(): Promise<any[]> {
  try {
    const data = await serverFetch<any>("/brands?activeOnly=true", { revalidate: 300 });
    return Array.isArray(data) ? data : data.data || [];
  } catch (err) {
    console.error("Failed to fetch brands from backend:", err);
    return [];
  }
}

export async function getFeaturedProductsServer(perPage = 50): Promise<Product[]> {
  const config = await getStorefrontConfigServer().catch(() => null);
  const hideOos = config?.features?.hideOosFromArchive === true;
  const res = await fetchProductsServer({
    isActive: true,
    isFeatured: true,
    perPage,
    hasStock: hideOos || undefined,
  });
  return res.data;
}

export async function getNewArrivalsServer(perPage = 8): Promise<Product[]> {
  const config = await getStorefrontConfigServer().catch(() => null);
  const hideOos = config?.features?.hideOosFromArchive === true;
  const res = await fetchProductsServer({
    isActive: true,
    perPage,
    sort: 'createdAt',
    order: 'desc',
    hasStock: hideOos || undefined,
  });
  return res.data;
}

export async function getPopularItemsServer(perPage = 8): Promise<Product[]> {
  const config = await getStorefrontConfigServer().catch(() => null);
  const hideOos = config?.features?.hideOosFromArchive === true;
  const res = await fetchProductsServer({
    isActive: true,
    perPage,
    sort: 'popularity',
    order: 'desc',
    hasStock: hideOos || undefined,
  });
  return res.data;
}

export const getProductBySlugServer = cache(async function getProductBySlugServer(slug: string): Promise<Product | null> {
  try {
    // Surge-safe: at most 1 retry with a short timeout on this hot path.
    const data = await serverFetch<any>(`/products/slug/${encodeURIComponent(slug)}`, {
      revalidate: 0,
      maxRetries: 1,
      timeout: 5000,
    });
    return data ? transformBackendProduct(data) : null;
  } catch (err) {
    console.error(`Failed to fetch product by slug ${slug} from backend:`, err);
    return null;
  }
});

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Server-side mirror of RelatedProducts' client logic: same category fetch,
// same tag-match priority + shuffle, top 8. Lets the PDP render related
// items without a browser waterfall (see page.tsx Promise.all).
export const getRelatedProductsServer = cache(async function getRelatedProductsServer(
  product: Product,
): Promise<Product[]> {
  try {
    const config = await getStorefrontConfigServer().catch(() => null);
    const hideOos = config?.features?.hideOosFromArchive === true;
    const res = await fetchProductsServer({
      isActive: true,
      perPage: 20,
      category: product.categorySlug || product.category || undefined,
      hasStock: hideOos || undefined,
    });
    let list = res.data.filter((p) => p.id !== product.id);
    const productTags = product.tags || [];
    if (productTags.length > 0) {
      const tagged = list.filter((p) => (p.tags || []).some((t) => productTags.includes(t)));
      const untagged = list.filter((p) => !(p.tags || []).some((t) => productTags.includes(t)));
      list = [...shuffleArray(tagged), ...shuffleArray(untagged)];
    } else {
      list = shuffleArray(list);
    }
    return list.slice(0, 8);
  } catch (err) {
    console.error(`Failed to fetch related products for ${product.slug} from backend:`, err);
    return [];
  }
});

// Best-selling slugs for generateStaticParams (PDP prerender). Build-safe:
// any backend failure resolves to [] so `next build` never needs the API.
export const getTopProductSlugsServer = cache(async function getTopProductSlugsServer(
  limit = 200,
): Promise<string[]> {
  try {
    const res = await fetchProductsServer({
      isActive: true,
      perPage: limit,
      sort: 'popularity',
      order: 'desc',
    });
    return res.data.map((p) => p.slug).filter((s): s is string => Boolean(s));
  } catch (err) {
    console.error('Failed to fetch top product slugs from backend:', err);
    return [];
  }
});

// Cheap backend reachability probe for the PDP outage-vs-404 distinction.
// Cached per request; single attempt with a short timeout — error paths only.
export const getBackendStatusServer = cache(async function getBackendStatusServer(): Promise<boolean> {
  try {
    await serverFetch<any>('/system-settings/storefront', { maxRetries: 0, timeout: 3000 });
    return true;
  } catch {
    return false;
  }
});

// Public reviews endpoint returns the { data, meta } envelope — unwrap here
// (with the same shape guard the client fallback uses) so SSR never breaks
// on the wrapper object. Never throws: PDP must render without reviews.
export const getReviewsServer = cache(async function getReviewsServer(slug: string): Promise<Review[]> {
  try {
    const body = await serverFetch<any>(`/reviews/product/${encodeURIComponent(slug)}`, {
      maxRetries: 1,
      timeout: 5000,
    });
    if (Array.isArray(body)) return body;
    return body?.data ?? [];
  } catch (err) {
    console.error(`Failed to fetch reviews for ${slug} from backend:`, err);
    return [];
  }
});
