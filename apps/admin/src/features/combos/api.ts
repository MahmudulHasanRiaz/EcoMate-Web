import { apiClient } from '@/lib/api-client'

export interface ComboItemResponse {
  id: string; comboId: string; productId: string; variantId?: string | null;
  quantity: number; price?: number | string | null;
  product: { id: string; name: string; slug: string; images: any; basePrice: number | string };
  variant?: { id: string; sku: string; price?: number | string | null } | null;
}

export interface ComboResponse {
  id: string; name: string; slug: string;
  description?: string | null; shortDesc?: string | null;
  basePrice: number | string; salePrice?: number | string | null;
  image?: string | null; images: any; categoryId?: string | null;
  tags: any; seoMeta: any;
  isFeatured: boolean; isActive: boolean;
  manageStock: boolean; stock: number;
  startDate?: string | null; endDate?: string | null;
  createdAt: string; updatedAt: string;
  category?: { id: string; name: string } | null;
  items: ComboItemResponse[];
}

export interface PaginatedResponse<T> { data: T[]; meta: { total: number; page: number; perPage: number; totalPages: number } }

export const combosApi = {
  list: (query?: any) => apiClient.get<PaginatedResponse<ComboResponse>>('/combos', { params: query }),
  get: (id: string) => apiClient.get<ComboResponse>(`/combos/${id}`),
  create: (data: any) => apiClient.post<ComboResponse>('/combos', data),
  update: (id: string, data: any) => apiClient.put<ComboResponse>(`/combos/${id}`, data),
  delete: (id: string) => apiClient.delete(`/combos/${id}`),
}
