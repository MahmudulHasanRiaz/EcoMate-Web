import apiClient from "../api-client";
import type { Combo } from "../types";

export interface CombosResponse {
  data: Combo[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

function transformBackendCombo(raw: any): Combo {
  const items = (raw.items || []).map((i: any) => ({
    productId: i.productId,
    productName: i.product?.name || "Unknown",
    productImage: Array.isArray(i.product?.images) ? i.product.images[0] : i.product?.images || "",
    productType: i.product?.type,
    variantId: i.variantId || undefined,
    variantLabel: i.variant?.sku || "",
    quantity: i.quantity,
    price: i.price ? Number(i.price) : undefined,
    variants: i.product?.variants
      ? i.product.variants.map((v: any) => ({
          id: v.id,
          sku: v.sku,
          price: Number(v.price),
          stock: v.managedStockQuantity,
          image: v.image || "",
          isActive: v.isActive ?? true,
          attributeValues: v.attributeValues?.map((av: any) => ({
            attributeValue: {
              id: av.attributeValue.id,
              value: av.attributeValue.value,
              attribute: {
                id: av.attributeValue.attribute.id,
                name: av.attributeValue.attribute.name,
              },
            },
          })) || [],
        }))
      : undefined,
  }));

  const basePrice = Number(raw.basePrice);
  const salePrice = raw.salePrice ? Number(raw.salePrice) : undefined;
  const img = raw.image || (Array.isArray(raw.images) ? raw.images[0] : "");

  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    price: salePrice || basePrice,
    basePrice,
    originalPrice: salePrice && salePrice < basePrice ? basePrice : undefined,
    salePrice,
    image: img,
    images: raw.images || [],
    discount: salePrice && salePrice < basePrice
      ? `${Math.round((1 - salePrice / basePrice) * 100)}%`
      : undefined,
    description: raw.description || "",
    shortDesc: raw.shortDesc || "",
    items,
    categoryId: raw.categoryId || undefined,
    category: raw.category || undefined,
    isActive: raw.isActive,
    isFeatured: raw.isFeatured,
    tags: raw.tags || [],
    seoMeta: raw.seoMeta,
    startDate: raw.startDate,
    endDate: raw.endDate,
  };
}

export async function getCombos(params?: {
  page?: number;
  perPage?: number;
  search?: string;
  isActive?: boolean;
  isFeatured?: boolean;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<CombosResponse> {
  const { data } = await apiClient.get("/combos", { params });
  return {
    data: (data.data || []).map(transformBackendCombo),
    meta: data.meta,
  };
}

export async function getCombo(id: string): Promise<Combo> {
  const { data } = await apiClient.get(`/combos/${id}`);
  return transformBackendCombo(data);
}
