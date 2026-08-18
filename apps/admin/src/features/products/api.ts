import { apiClient } from '@/lib/api-client'

export interface ProductVariantResponse {
  id: string; productId: string; sku: string; sortOrder?: number; price?: number | string | null;
  salePrice?: number | string | null;
  managedStockQuantity: number; standardCost?: number | string | null; image?: string | null; images?: string[] | null; isActive: boolean;
  attributeValues: { attributeValue: { id: string; value: string; attribute: { id: string; name: string } } }[];
}

export interface ProductResponse {
  id: string; name: string; slug: string; type: string;
  description?: string | null; shortDesc?: string | null;
  basePrice: number | string; salePrice?: number | string | null;
  sku?: string | null; managedStockQuantity: number; lowStockQty?: number | null;
  categoryId?: string | null; brandId?: string | null; tags: any; images: any; seoMeta: any;
  isFeatured: boolean; isActive: boolean; manageStock: boolean;
  availabilityMode?: string; standardCost?: number | string | null;
  status?: 'active' | 'draft';
  createdAt: string; updatedAt: string;
  category?: { id: string; name: string } | null;
  variants: ProductVariantResponse[];
}

export interface PaginatedResponse<T> { data: T[]; meta: { total: number; page: number; perPage: number; totalPages: number } }

export const productsApi = {
  list: (query?: any) => apiClient.get<PaginatedResponse<ProductResponse>>('/products', { params: query }),
  get: (id: string) => apiClient.get<ProductResponse>(`/products/${id}`),
  create: (data: any) => apiClient.post<ProductResponse>('/products', data),
  update: (id: string, data: any) => apiClient.put<ProductResponse>(`/products/${id}`, data),
  delete: (id: string) => apiClient.delete(`/products/${id}`),
  createDraft: (data: any) => apiClient.post<ProductResponse>('/products/draft', data),
  updateDraft: (id: string, data: any) => apiClient.put<ProductResponse>(`/products/draft/${id}`, data),
  publishDraft: (id: string, data: any) => apiClient.post<ProductResponse>(`/products/draft/${id}/publish`, data),
  bulkDelete: (ids: string[]) => apiClient.post('/products/bulk/delete', { ids }),
  bulkUpdate: (ids: string[], data: any) => apiClient.post('/products/bulk/update', { ids, data }),
  generateVariants: (id: string, data: { attributeIds: string[]; defaultPrice?: number; defaultManagedStockQuantity?: number }) =>
    apiClient.post<ProductResponse>(`/products/${id}/variants/generate`, data),
  updateVariant: (id: string, variantId: string, data: { sku?: string; price?: number; salePrice?: number; standardCost?: number | null; image?: string | null; images?: string[] }) =>
    apiClient.put<ProductVariantResponse>(`/products/${id}/variants/${variantId}`, data),
  reorderVariants: (id: string, orderedIds: string[]) =>
    apiClient.put<ProductResponse>(`/products/${id}/variants/reorder`, { orderedIds }),
  removeAllVariants: (id: string) =>
    apiClient.delete<{ message: string }>(`/products/${id}/variants`),
  removeVariant: (id: string, variantId: string) =>
    apiClient.delete<{ message: string }>(`/products/${id}/variants/${variantId}`),
}

export const uploadApi = {
  image: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return apiClient.post<{ url: string; filename: string; size: number }>('/upload/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    });
  },
}
