import { apiClient } from '@/lib/api-client'

export interface DispatchResponse {
  id: string
  orderId: string
  courier: string
  consignmentId: string
  trackingCode: string | null
  trackingUrl: string | null
  status: string
  handedOverAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  productMapping: any
  notes: string | null
  createdAt: string
  updatedAt: string
  order?: { displayId: string; total: number; guestName?: string; guestPhone?: string }
}

export interface DispatchMetricsResponse {
  courier: string
  status: string
  _count: number
}

export const dispatchApi = {
  list: (params?: any) =>
    apiClient.get<{ data: DispatchResponse[]; total: number }>('/dispatch', { params }),
  get: (id: string) => apiClient.get<DispatchResponse>(`/dispatch/${id}`),
  create: (data: any) => apiClient.post<DispatchResponse>('/dispatch', data),
  updateStatus: (id: string, status: string) =>
    apiClient.patch(`/dispatch/${id}/status`, { status }),
  remove: (id: string) => apiClient.delete(`/dispatch/${id}`),
  getMetrics: () => apiClient.get<DispatchMetricsResponse[]>('/dispatch/metrics'),
}
