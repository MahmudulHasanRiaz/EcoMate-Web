import { serverFetch } from "../api-server";
import type { Product, Variant, Category } from "../types";

export interface ProductsResponse {
  data: Product[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
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

export async function getProductsServer(params?: {
  page?: number;
  perPage?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  isFeatured?: boolean;
  sort?: string;
  order?: string;
}): Promise<ProductsResponse> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.perPage) qs.set("perPage", String(params.perPage));
  if (params?.search) qs.set("search", params.search);
  if (params?.categoryId) qs.set("categoryId", params.categoryId);
  if (params?.isActive !== undefined) qs.set("isActive", String(params.isActive));
  if (params?.isFeatured !== undefined) qs.set("isFeatured", String(params.isFeatured));
  if (params?.sort) qs.set("sort", params.sort);
  if (params?.order) qs.set("order", params.order);
  const q = qs.toString();
  const data = await serverFetch<any>(`/products${q ? `?${q}` : ""}`, { revalidate: 300 });
  return {
    data: (data.data || []).map(transformBackendProduct),
    meta: data.meta,
  };
}

export async function getFeaturedProductsServer(): Promise<Product[]> {
  const { data } = await getProductsServer({
    isActive: true,
    isFeatured: true,
    perPage: 50,
  });
  return data;
}

export async function getProductBySlugServer(slug: string): Promise<Product> {
  const { data } = await getProductsServer({ search: slug, perPage: 1 });
  const found = data.find((p: any) => p.slug === slug);
  if (found) return found;

  const byId = await serverFetch<any>(`/products/${slug}`);
  return transformBackendProduct(byId);
}

export async function getCategoriesServer(): Promise<Category[]> {
  const data = await serverFetch<any>("/categories", { revalidate: 300 });
  return Array.isArray(data) ? data : data.data || [];
}
