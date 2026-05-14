import { apiClient } from '@/lib/api-client'

export interface CategoryResponse {
  id: string
  name: string
  slug: string
  parentId?: string | null
  image?: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  children?: CategoryResponse[]
  parent?: CategoryResponse | null
  _count?: { products: number }
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface CategoriesQuery {
  page?: number
  perPage?: number
  search?: string
  isActive?: string
  parentId?: string
  sort?: string
  order?: string
}

export const categoriesApi = {
  list: (query?: CategoriesQuery) =>
    apiClient.get<PaginatedResponse<CategoryResponse>>('/categories', { params: query }),

  get: (id: string) =>
    apiClient.get<CategoryResponse>(`/categories/${id}`),

  create: (data: {
    name: string
    slug: string
    parentId?: string
    image?: string
    sortOrder?: number
  }) => apiClient.post<CategoryResponse>('/categories', data),

  update: (id: string, data: {
    name?: string
    slug?: string
    parentId?: string | null
    image?: string | null
    sortOrder?: number
    isActive?: boolean
  }) => apiClient.put<CategoryResponse>(`/categories/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/categories/${id}`),
}
