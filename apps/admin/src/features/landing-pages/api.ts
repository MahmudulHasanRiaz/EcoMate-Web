import { apiClient } from '@/lib/api-client'

export interface LandingPage {
  id: string
  title: string
  slug: string
  pageType: 'template' | 'custom'
  templateId: string | null
  sections: any[]
  customHtml: string | null
  customCss: string | null
  productIds: string[]
  comboIds: string[]
  trackingJson: Record<string, any>
  isActive: boolean
  isDraft: boolean
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export const landingPagesApi = {
  list: (params?: { page?: number; perPage?: number }) =>
    apiClient.get<{ data: LandingPage[]; meta: any }>('/landing-pages', { params }),
  get: (id: string) =>
    apiClient.get<LandingPage>(`/landing-pages/${id}`),
  create: (data: Partial<LandingPage>) =>
    apiClient.post<LandingPage>('/landing-pages', data),
  update: (id: string, data: Partial<LandingPage>) =>
    apiClient.put<LandingPage>(`/landing-pages/${id}`, data),
  delete: (id: string) =>
    apiClient.delete(`/landing-pages/${id}`),
  publish: (id: string) =>
    apiClient.post<LandingPage>(`/landing-pages/${id}/publish`),
  unpublish: (id: string) =>
    apiClient.post<LandingPage>(`/landing-pages/${id}/unpublish`),
}
