import { apiClient } from '@/lib/api-client'

export interface SupportEnquiry {
  id: string
  name: string
  email: string | null
  phone: string | null
  subject: string | null
  message: string
  orderId: string | null
  status: 'NEW' | 'REPLIED'
  repliedById: string | null
  repliedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SupportEnquiryListResponse {
  data: SupportEnquiry[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const supportEnquiriesApi = {
  list: (params?: { status?: string; page?: number; perPage?: number }) =>
    apiClient.get<SupportEnquiryListResponse>('/support-enquiries', { params }),
  get: (id: string) => apiClient.get<SupportEnquiry>(`/support-enquiries/${id}`),
  updateStatus: (id: string, status: 'NEW' | 'REPLIED') =>
    apiClient.patch<SupportEnquiry>(`/support-enquiries/${id}`, { status }),
}
