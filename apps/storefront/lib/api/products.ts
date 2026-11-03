import apiClient from "../api-client";
import type { Product, ProductCardData, Variant, Category } from "../types";
import { sanitizeDefinition } from "../customization";

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
  const rawSalePrice = raw.salePrice != null ? Number(raw.salePrice) : undefined;
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
      const saleP = v.salePrice != null ? Number(v.salePrice) : undefined;
      return {
        id: v.id,
        sku: v.sku,
        price: saleP ?? regPrice,
        regularPrice: regPrice,
        salePrice: saleP,
        stock: (v.availableStock !== undefined && v.availableStock !== null) ? v.availableStock : (v.managedStockQuantity ?? 0),
        image: v.image || undefined,
        images: (Array.isArray(v.images) ? v.images : (v.image ? [v.image] : [])).filter(Boolean) as string[],
        isActive: v.isActive !== false,
        attributeValues: v.attributeValues || [],
      };
    });

  const rawOriginalPrice = raw.originalPrice != null ? Number(raw.originalPrice) : undefined;

  let displayPrice: number;
  let displayOriginalPrice: number | undefined;
  let displaySalePrice: number | undefined;
  let displayBasePrice: number;
  let minPrice: number | undefined;
  let maxPrice: number | undefined;

  if (isVar && variants.length > 0) {
    const prices = variants.map((v) => v.price);
    minPrice = Math.min(...prices);
    maxPrice = Math.max(...prices);
    const minRegPrice = Math.min(...variants.map((v) => v.regularPrice));
    const hasSale = variants.some((v) => v.salePrice !== undefined && v.salePrice! < v.regularPrice);
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

  const mediaMeta = raw._mediaMeta || undefined;

  return {
    id: raw.id,
    mediaMeta,
    name: raw.name,
    slug: raw.slug,
    price: displayPrice,
    basePrice: displayBasePrice,
    originalPrice: displayOriginalPrice,
    salePrice: displaySalePrice,
    priceRange: isVar && variants.length > 0 && minPrice !== undefined && maxPrice !== undefined && minPrice !== maxPrice ? { min: minPrice, max: maxPrice } : undefined,
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
    stock: raw.availableStock !== undefined ? raw.availableStock : raw.managedStockQuantity,
    sku: raw.sku || undefined,
    type: raw.type,
    manageStock: raw.manageStock,
    availabilityMode: raw.availabilityMode,
    tags: raw.tags || [],
    isActive: raw.isActive,
    variants: variants.length > 0 ? variants : undefined,
    codAvailable: raw.codAvailable,
    descriptionSections: raw.descriptionSections,
    videoUrl: raw.videoUrl || undefined,
    detailRows: Array.isArray(raw.detailRows) ? raw.detailRows : undefined,
    customizations: sanitizeDefinition(raw.customizations),
    rating: raw.averageRating || raw.rating || 0,
    reviewCount: raw._count?.reviews ?? raw.reviewCount,
    averageRating: raw.averageRating || raw.rating || 0,
    brand: raw.brand ? { id: raw.brand.id, name: raw.brand.name, slug: raw.brand.slug } : null,
  };
}

/**
 * P2: project a fully-transformed product down to the list-card shape.
 * Runs the SAME transform first, so every derived value the card shows
 * (display price / price range, original price, save amount, badge,
 * available stock, variant stock) is byte-identical to the full product —
 * only the payload shrinks. Heavy fields never cross this boundary:
 * description HTML, sections, customizations, gallery images, the full
 * variant tree, and every derivative URL except the primary image's
 * `small` derivative (the only one ProductCard renders).
 */
export function toCardProduct(product: Product): ProductCardData {
  const variants = product.variants || [];
  const primaryMeta = product.image ? product.mediaMeta?.[product.image] : undefined;
  const small = primaryMeta?.derivativeManifest?.small;
  return {
    id: product.id,
    // Only the `small` derivative survives: it is the single derivative
    // URL ProductCard renders. (The card's blur placeholder is a shared
    // constant, not the per-image blurUrl — so that URL is dropped too.)
    mediaMeta:
      product.image && small
        ? {
            [product.image]: {
              derivativeManifest: { small },
              blurUrl: null,
            },
          }
        : undefined,
    name: product.name,
    slug: product.slug,
    price: product.price,
    originalPrice: product.originalPrice,
    priceRange: product.priceRange,
    image: product.image,
    category: product.category,
    categoryId: product.categoryId,
    categorySlug: product.categorySlug,
    brand: product.brand ?? null,
    badge: product.badge,
    saveAmount: product.saveAmount,
    isFeatured: product.isFeatured,
    stock: product.stock,
    sku: product.sku,
    type: product.type,
    tags: product.tags,
    availabilityMode: product.availabilityMode,
    hasVariants: variants.length > 0,
    variantCount: variants.length,
    anyVariantInStock: variants.some((v) => v.isActive && v.stock > 0),
    rating: product.rating,
    reviewCount: product.reviewCount,
    averageRating: product.averageRating,
  };
}

/** Card projection straight from a raw backend list row. */
export function transformBackendProductCard(raw: any): ProductCardData {
  return toCardProduct(transformBackendProduct(raw));
}

export interface ProductCardsResponse {
  data: ProductCardData[];
  meta: ProductsResponse['meta'];
}

export type ProductListParams = {
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
};

/**
 * List fetch for card surfaces. Asks the backend for its opt-in
 * `fields=card` slim response (older backends ignore the unknown param
 * and return the full payload — the client-side projection below slims
 * it either way, so mixed-version deploys stay correct).
 */
export async function getProductCards(params?: ProductListParams): Promise<ProductCardsResponse> {
  const { signal: abortSignal, ...queryParams } = params || {};
  const { data } = await apiClient.get("/products", {
    params: { ...queryParams, fields: 'card' },
    signal: abortSignal,
  });
  return {
    data: (data.data || []).map(transformBackendProductCard),
    meta: data.meta,
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
  const { signal: abortSignal, ...queryParams } = params || {};
  // signal must be a TOP-LEVEL axios config — nested inside params it would be
  // serialized into the query string (`signal=[object AbortSignal]`) and cancel
  // nothing (verified empirically). Top-level config.signal aborts the request.
  const { data } = await apiClient.get("/products", { params: queryParams, signal: abortSignal });
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

function transformCategory(raw: any): Category {
  return {
    ...raw,
    mediaMeta: raw._mediaMeta || undefined,
  };
}

export async function getCategories(): Promise<Category[]> {
  const { data } = await apiClient.get("/categories");
  const list = Array.isArray(data) ? data : data.data || [];
  return list.map(transformCategory);
}

export async function getMenuCategories(): Promise<Category[]> {
  const { data } = await apiClient.get("/categories/menu");
  const list = Array.isArray(data) ? data : data.data || [];
  return list.map(transformCategory);
}
