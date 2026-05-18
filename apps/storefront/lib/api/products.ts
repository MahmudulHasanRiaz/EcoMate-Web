import apiClient from "../api-client";
import type { Product, Category } from "../types";

export interface ProductsResponse {
  data: Product[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

export async function getProducts(params?: {
  page?: number;
  perPage?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  sort?: string;
  order?: string;
}): Promise<ProductsResponse> {
  const { data } = await apiClient.get("/products", { params });
  return data;
}

export async function getProduct(id: string): Promise<Product> {
  const { data } = await apiClient.get(`/products/${id}`);
  return data;
}

export async function getProductBySlug(slug: string): Promise<Product> {
  const { data } = await apiClient.get("/products", {
    params: { search: slug, perPage: 1 },
  });
  const found = data.data.find(
    (p: Product) => p.slug === slug,
  );
  if (!found) throw new Error("Product not found");
  return found;
}

export async function getFeaturedProducts(): Promise<Product[]> {
  const { data } = await apiClient.get("/products", {
    params: { isActive: true, perPage: 50 },
  });
  return data.data.filter((p: Product) => p.isFeatured);
}

export async function getCategories(): Promise<Category[]> {
  const { data } = await apiClient.get("/categories");
  return data;
}
