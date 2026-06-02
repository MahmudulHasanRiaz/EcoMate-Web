import apiClient from "../api-client";
import type { Product, Variant, Category } from "../types";

export interface ProductsResponse {
  data: Product[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

function transformBackendProduct(raw: any): Product {
  const basePrice = Number(raw.basePrice);
  const salePrice = raw.salePrice ? Number(raw.salePrice) : undefined;
  const rawImages = Array.isArray(raw.images) ? raw.images : [];
  const firstImage = rawImages.length > 0 ? rawImages[0] : null;

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
    variants: variants.length > 0 ? variants : undefined,
  };
}

export async function getProducts(params?: {
  page?: number;
  perPage?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  isFeatured?: boolean;
  sort?: string;
  order?: string;
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
  const { data } = await apiClient.get("/products", {
    params: { search: slug, perPage: 1 },
  });
  const found = data.data.find((p: any) => p.slug === slug);
  if (!found) throw new Error("Product not found");
  return transformBackendProduct(found);
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
