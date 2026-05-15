import { apiClient } from '@/lib/api-client'

export interface ProductVariantResponse {
  id: string; productId: string; sku: string; price?: number | string | null;
  stock: number; image?: string | null; isActive: boolean;
  attributeValues: { attributeValue: { id: string; value: string; attribute: { id: string; name: string } } }[];
}

export interface ProductResponse {
  id: string; name: string; slug: string; type: string;
  description?: string | null; shortDesc?: string | null;
  basePrice: number | string; salePrice?: number | string | null;
  sku?: string | null; stock: number; lowStockQty?: number | null;
  categoryId?: string | null; tags: any; images: any; seoMeta: any;
  isFeatured: boolean; isActive: boolean; manageStock: boolean;
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
  generateVariants: (id: string, data: { attributeIds: string[]; defaultPrice?: number; defaultStock?: number }) =>
    apiClient.post<ProductResponse>(`/products/${id}/variants/generate`, data),
}

export const uploadApi = {
  image: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return apiClient.post<{ url: string; filename: string; size: number }>('/upload/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
}
