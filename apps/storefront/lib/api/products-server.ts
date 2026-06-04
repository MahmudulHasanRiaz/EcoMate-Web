import { serverFetch } from "../api-server";
import type { Product, Variant, Category } from "../types";

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
  isActive?: boolean;
  isFeatured?: boolean;
  ids?: string;
  sort?: string;
  order?: string;
}

function buildQuery(params: FetchProductsServerOpts): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.perPage) sp.set("perPage", String(params.perPage));
  if (params.search) sp.set("search", params.search);
  if (params.type) sp.set("type", params.type);
  if (params.categoryId) sp.set("categoryId", params.categoryId);
  if (params.isActive !== undefined) sp.set("isActive", String(params.isActive));
  if (params.isFeatured !== undefined) sp.set("isFeatured", String(params.isFeatured));
  if (params.ids) sp.set("ids", params.ids);
  if (params.sort) sp.set("sort", params.sort);
  if (params.order) sp.set("order", params.order);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function transformBackendProduct(raw: any): Product {
  const rawBasePrice = Number(raw.basePrice);
  const rawSalePrice = raw.salePrice ? Number(raw.salePrice) : undefined;
  const rawImages = Array.isArray(raw.images) ? raw.images : [];
  const firstImage = rawImages.length > 0 ? rawImages[0] : null;
  const isVar = (raw.type || 'simple') === 'variable';

  const variants: Variant[] = (raw.variants || [])
    .filter((v: any) =>
      !v.attributeValues?.some((av: any) =>
        av.attributeValue?.value?.includes(', ')
      )
    )
    .map((v: any) => ({
      id: v.id,
      sku: v.sku,
      price: Number(v.price) || 0,
      stock: v.stock ?? 0,
      image: v.image || undefined,
      isActive: v.isActive !== false,
      attributeValues: v.attributeValues || [],
    }));

  let displayPrice: number;
  let displayOriginalPrice: number | undefined;
  let displaySalePrice: number | undefined;
  let displayBasePrice: number;

  if (isVar && variants.length > 0) {
    const prices = variants.filter((v) => v.price > 0).map((v) => v.price);
    const minPrice = prices.length > 0 ? Math.min(...prices) : rawBasePrice;
    displayPrice = minPrice;
    displayBasePrice = minPrice;
    displaySalePrice = undefined;
    displayOriginalPrice = undefined;
  } else {
    displayPrice = rawSalePrice || rawBasePrice;
    displayBasePrice = rawBasePrice;
    displaySalePrice = rawSalePrice;
    displayOriginalPrice = rawSalePrice && rawSalePrice < rawBasePrice ? rawBasePrice : undefined;
  }

  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    price: displayPrice,
    basePrice: displayBasePrice,
    originalPrice: displayOriginalPrice,
    salePrice: displaySalePrice,
    image: firstImage,
    images: rawImages,
    category: raw.category?.name || "",
    categoryId: raw.categoryId || undefined,
    badge: raw.isFeatured ? "Featured" : displaySalePrice ? "Sale" : undefined,
    saveAmount: displayOriginalPrice ? displayOriginalPrice - displayPrice : undefined,
    isFeatured: raw.isFeatured,
    description: raw.description || "",
    shortDesc: raw.shortDesc || "",
    stock: raw.stock,
    sku: raw.sku || undefined,
    type: raw.type,
    tags: raw.tags || [],
    isActive: raw.isActive,
    manageStock: raw.manageStock,
    variants: variants.length > 0 ? variants : undefined,
  };
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

export async function getProductBySlugServer(slug: string): Promise<Product | null> {
  const res = await fetchProductsServer({ search: slug, perPage: 1 });
  const found = res.data.find((p) => p.slug === slug);
  if (found) return found;

  try {
    const byId = await serverFetch<any>(`/products/${slug}`, { revalidate: 60 });
    return byId?.id ? transformBackendProduct(byId) : null;
  } catch {
    return null;
  }
}
