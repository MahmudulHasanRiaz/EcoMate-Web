import { apiClient } from '@/lib/api-client'

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  variables: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface EmailCampaign {
  id: string
  name: string
  subject: string
  templateId?: string | null
  content?: string | null
  recipients?: { email: string; name?: string }[]
  segmentFilter?: Record<string, any>
  scheduledAt?: string | null
  sentAt?: string | null
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  totalSent: number
  totalFailed: number
  createdBy?: string | null
  createdAt: string
  updatedAt: string
  template?: { id: string; name: string } | null
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const campaignsApi = {
  templates: {
    list: () => apiClient.get<EmailTemplate[]>('/campaigns/templates'),
    create: (data: { name: string; subject: string; body: string; variables?: string[]; isActive?: boolean }) =>
      apiClient.post<EmailTemplate>('/campaigns/templates', data),
    update: (id: string, data: Partial<{ name: string; subject: string; body: string; variables?: string[]; isActive?: boolean }>) =>
      apiClient.put<EmailTemplate>(`/campaigns/templates/${id}`, data),
    delete: (id: string) => apiClient.delete(`/campaigns/templates/${id}`),
  },
  list: (params?: { page?: number; perPage?: number; status?: string }) =>
    apiClient.get<PaginatedResponse<EmailCampaign>>('/campaigns', { params }),
  get: (id: string) =>
    apiClient.get<EmailCampaign>(`/campaigns/${id}`),
  create: (data: {
    name: string
    subject: string
    templateId?: string
    content?: string
    recipients?: { email: string; name?: string }[]
    segmentFilter?: Record<string, any>
    scheduledAt?: string
  }) => apiClient.post<EmailCampaign>('/campaigns', data),
  update: (id: string, data: Partial<{
    name: string
    subject: string
    templateId: string
    content: string
    recipients: { email: string; name?: string }[]
    segmentFilter: Record<string, any>
    scheduledAt: string
  }>) => apiClient.put<EmailCampaign>(`/campaigns/${id}`, data),
  delete: (id: string) => apiClient.delete(`/campaigns/${id}`),
  send: (id: string) => apiClient.post(`/campaigns/${id}/send`),
  sendTest: (id: string, email: string) => apiClient.post(`/campaigns/${id}/test`, { email }),
}
