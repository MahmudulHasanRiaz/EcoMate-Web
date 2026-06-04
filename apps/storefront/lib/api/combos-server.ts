import { serverFetch } from "../api-server";
import type { Combo } from "@/lib/types";

export interface ServerCombosResponse {
  data: Combo[];
  meta: {
    total: number;
    perPage: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface FetchCombosServerOpts {
  cursor?: string;
  perPage?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  sort?: string;
  order?: string;
}

function buildQuery(params: FetchCombosServerOpts): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.perPage) sp.set("perPage", String(params.perPage));
  if (params.search) sp.set("search", params.search);
  if (params.categoryId) sp.set("categoryId", params.categoryId);
  if (params.isActive !== undefined) sp.set("isActive", String(params.isActive));
  if (params.sort) sp.set("sort", params.sort);
  if (params.order) sp.set("order", params.order);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
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
          stock: v.stock,
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

export async function fetchCombosServer(
  opts: FetchCombosServerOpts = {},
): Promise<ServerCombosResponse> {
  const url = `/combos${buildQuery(opts)}`;
  const data = await serverFetch<any>(url, { revalidate: 60 });
  return {
    data: (data.data || []).map(transformBackendCombo),
    meta: {
      total: data.meta?.total ?? 0,
      perPage: data.meta?.perPage ?? opts.perPage ?? 12,
      nextCursor: data.meta?.nextCursor ?? null,
      hasMore: Boolean(data.meta?.hasMore),
    },
  };
}
