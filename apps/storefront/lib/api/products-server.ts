import { serverFetch } from "../api-server";
import type { Product, Category } from "../types";

export interface ProductsResponse {
  data: Product[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

function transformBackendProduct(raw: any): Product {
  const basePrice = Number(raw.basePrice);
  const salePrice = raw.salePrice ? Number(raw.salePrice) : undefined;
  const rawImages = Array.isArray(raw.images) ? raw.images : [];
  const firstImage = rawImages.length > 0 ? rawImages[0] : null;

  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    price: salePrice || basePrice,
    basePrice,
    originalPrice: salePrice && salePrice < basePrice ? basePrice : undefined,
    salePrice,
    image: firstImage,
    images: rawImages,
    category: raw.category?.name || "",
    categoryId: raw.categoryId || undefined,
    badge: raw.isFeatured ? "Featured" : raw.salePrice ? "Sale" : undefined,
    saveAmount: salePrice && salePrice < basePrice ? basePrice - salePrice : undefined,
    isFeatured: raw.isFeatured,
    description: raw.description || "",
    shortDesc: raw.shortDesc || "",
    stock: raw.stock,
    sku: raw.sku || undefined,
    type: raw.type,
    tags: raw.tags || [],
    isActive: raw.isActive,
    manageStock: raw.manageStock,
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
