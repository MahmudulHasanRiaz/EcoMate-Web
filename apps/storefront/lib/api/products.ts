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
    .map((v: any) => {
      const regPrice = Number(v.price) || 0;
      const saleP = v.salePrice ? Number(v.salePrice) : undefined;
      return {
        id: v.id,
        sku: v.sku,
        price: saleP ?? regPrice,
        regularPrice: regPrice,
        salePrice: saleP,
        stock: v.stock ?? 0,
        image: v.image || undefined,
        isActive: v.isActive !== false,
        attributeValues: v.attributeValues || [],
      };
    });

  const rawOriginalPrice = raw.originalPrice ? Number(raw.originalPrice) : undefined;

  let displayPrice: number;
  let displayOriginalPrice: number | undefined;
  let displaySalePrice: number | undefined;
  let displayBasePrice: number;

  if (isVar && variants.length > 0) {
    const prices = variants.map((v) => v.price);
    const minPrice = Math.min(...prices);
    const minRegPrice = Math.min(...variants.map((v) => v.regularPrice!));
    const hasSale = variants.some((v) => v.salePrice !== undefined && v.salePrice! < v.regularPrice!);
    displayPrice = minPrice;
    displayBasePrice = rawBasePrice;
    displaySalePrice = hasSale ? minPrice : undefined;
    displayOriginalPrice = hasSale
      ? Math.min(minRegPrice, rawBasePrice > 0 ? rawBasePrice : Infinity)
      : (rawBasePrice > 0 && rawBasePrice > minPrice ? rawBasePrice
        : rawOriginalPrice && rawOriginalPrice > minPrice ? rawOriginalPrice : undefined);
    if (displayOriginalPrice === Infinity) displayOriginalPrice = undefined;
  } else {
    // Simple product: price = salePrice or basePrice, original = basePrice when sale is lower
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
    badge: raw.isFeatured ? "Featured" : displayOriginalPrice ? "Sale" : undefined,
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
    brand: raw.brand ? { id: raw.brand.id, name: raw.brand.name, slug: raw.brand.slug } : null,
  };
}

export async function getProducts(params?: {
  page?: number;
  perPage?: number;
  search?: string;
  categoryId?: string;
  category?: string;
  tagSlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  isActive?: boolean;
  isFeatured?: boolean;
  hasStock?: boolean;
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
