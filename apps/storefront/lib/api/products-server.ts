import { serverFetch } from "../api-server";
import type { Product, Variant, Category } from "../types";
import { transformBackendProduct } from "./products";

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

export async function fetchProductsServer(
  opts: FetchProductsServerOpts = {},
): Promise<ServerProductsResponse> {
  const url = `/products${buildQuery(opts)}`;
  const data = await serverFetch<any>(url, { revalidate: 60 });
  return {
    data: (data.data || []).map(transformBackendProduct),
    meta: {
      total: data.meta?.total ?? 0,
      perPage: data.meta?.perPage ?? opts.perPage ?? 24,
      nextCursor: data.meta?.nextCursor ?? null,
      hasMore: Boolean(data.meta?.hasMore),
    },
  };
}

export async function getCategoriesServer(): Promise<Category[]> {
  const data = await serverFetch<any>("/categories", { revalidate: 300 });
  return Array.isArray(data) ? data : data.data || [];
}

export async function getFeaturedProductsServer(perPage = 50): Promise<Product[]> {
  const res = await fetchProductsServer({
    isActive: true,
    isFeatured: true,
    perPage,
  });
  return res.data;
}

export async function getNewArrivalsServer(perPage = 8): Promise<Product[]> {
  const res = await fetchProductsServer({
    isActive: true,
    perPage,
    sort: 'createdAt',
    order: 'desc',
  });
  return res.data;
}

export async function getPopularItemsServer(perPage = 8): Promise<Product[]> {
  const res = await fetchProductsServer({
    isActive: true,
    isFeatured: true,
    perPage,
    sort: 'updatedAt',
    order: 'desc',
  });
  return res.data;
}

export async function getProductBySlugServer(slug: string): Promise<Product | null> {
  const data = await serverFetch<any>(`/products/slug/${encodeURIComponent(slug)}`, { revalidate: 60 });
  return data ? transformBackendProduct(data) : null;
}
