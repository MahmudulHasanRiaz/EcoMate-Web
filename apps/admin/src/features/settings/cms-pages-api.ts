import { apiClient } from '@/lib/api-client'

export interface CmsPage {
  id: string
  slug: string
  title: string
  content: string
  isActive: boolean
  showInFooter: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateCmsPageInput {
  slug: string
  title: string
  content: string
  isActive?: boolean
  showInFooter?: boolean
  sortOrder?: number
}

export const cmsPagesApi = {
  list: () => apiClient.get<CmsPage[]>('/cms-pages').then(r => r.data),
  get: (id: string) => apiClient.get<CmsPage>(`/cms-pages/${id}`).then(r => r.data),
  create: (data: CreateCmsPageInput) => apiClient.post<CmsPage>('/cms-pages', data).then(r => r.data),
  update: (id: string, data: Partial<CreateCmsPageInput>) => apiClient.put<CmsPage>(`/cms-pages/${id}`, data).then(r => r.data),
  remove: (id: string) => apiClient.delete(`/cms-pages/${id}`).then(r => r.data),
}
