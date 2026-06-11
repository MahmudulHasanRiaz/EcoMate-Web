import apiClient from "../api-client";
import type { Product, Variant, Category } from "../types";

export interface ProductsResponse {
  data: Product[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export function transformBackendProduct(raw: any): Product {
  const rawBasePrice = Number(raw.basePrice) || 0;
  const rawSalePrice = raw.salePrice ? Number(raw.salePrice) || 0 : undefined;
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

  const rawOriginalPrice = raw.originalPrice ? Number(raw.originalPrice) : undefined;

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
    displayOriginalPrice = rawOriginalPrice && rawOriginalPrice > minPrice ? rawOriginalPrice : undefined;
  } else {
    displayPrice = rawSalePrice || rawBasePrice;
    displayBasePrice = rawBasePrice;
    displaySalePrice = rawSalePrice;
    displayOriginalPrice = rawSalePrice && rawSalePrice < rawBasePrice
      ? rawBasePrice
      : (rawOriginalPrice && rawOriginalPrice > displayPrice ? rawOriginalPrice : undefined);
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
    categorySlug: raw.category?.slug || undefined,
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
    codAvailable: raw.codAvailable,
    descriptionSections: raw.descriptionSections,
    rating: raw.averageRating || raw.rating || 0,
    reviewCount: raw._count?.reviews ?? raw.reviewCount,
    averageRating: raw.averageRating || raw.rating || 0,
  };
}

export async function getProducts(params?: {
  page?: number;
  perPage?: number;
  search?: string;
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
  cursor?: string;
  signal?: AbortSignal;
}): Promise<ProductsResponse> {
  const { data } = await apiClient.get("/products", { params });
  return {
    data: (data.data || []).map(transformBackendProduct),
    meta: data.meta,
  };
}

export async function getProduct(id: string): Promise<Product> {
  const { data } = await apiClient.get(`/products/${id}`);
  return transformBackendProduct(data);
}

export async function getProductBySlug(slug: string): Promise<Product> {
  const { data } = await apiClient.get(`/products/slug/${encodeURIComponent(slug)}`);
  return transformBackendProduct(data);
}

export async function getFeaturedProducts(): Promise<Product[]> {
  const { data } = await apiClient.get("/products", {
    params: { isActive: true, isFeatured: true, perPage: 50 },
  });
  return (data.data || []).map(transformBackendProduct);
}

export async function getCategories(): Promise<Category[]> {
  const { data } = await apiClient.get("/categories");
  return Array.isArray(data) ? data : data.data || [];
}
