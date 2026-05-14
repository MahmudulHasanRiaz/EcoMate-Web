import { apiClient } from '@/lib/api-client'

export interface ProductResponse {
  id: string
  name: string
  slug: string
  description?: string | null
  basePrice: number
  salePrice?: number | null
  categoryId?: string | null
  tags: any
  images: any
  seoMeta: any
  isActive: boolean
  createdAt: string
  updatedAt: string
  category?: { id: string; name: string } | null
  variants: {
    id: string
    sku: string
    price?: number | null
    stock: number
    image?: string | null
    attributeValues: {
      attributeValue: {
        id: string
        value: string
        attribute: { id: string; name: string }
      }
    }[]
  }[]
  _count?: { orderItems: number }
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const productsApi = {
  list: (query?: any) =>
    apiClient.get<PaginatedResponse<ProductResponse>>('/products', {
      params: query,
    }),
  get: (id: string) =>
    apiClient.get<ProductResponse>(`/products/${id}`),
  create: (data: any) =>
    apiClient.post<ProductResponse>('/products', data),
  update: (id: string, data: any) =>
    apiClient.put<ProductResponse>(`/products/${id}`, data),
  delete: (id: string) => apiClient.delete(`/products/${id}`),
}
