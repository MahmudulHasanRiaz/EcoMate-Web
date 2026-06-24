import { apiClient } from '@/lib/api-client'

export interface NotificationSettingResponse {
  id: string
  channel: 'email' | 'sms'
  type: 'order_confirmation' | 'payment_received' | 'shipment_update' | 'low_stock'
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface NotificationLogResponse {
  id: string
  channel: 'email' | 'sms'
  eventType: string
  recipient: string
  status: 'sent' | 'failed' | 'pending'
  sentAt: string
  createdAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const notifApi = {
  listSettings: () =>
    apiClient.get<NotificationSettingResponse[]>('/notifications/settings'),

  createSetting: (data: {
    channel: string
    type: string
    enabled: boolean
  }) => apiClient.post<NotificationSettingResponse>('/notifications/settings', data),

  updateSetting: (id: string, data: Partial<{
    channel: string
    type: string
    enabled: boolean
  }>) => apiClient.put<NotificationSettingResponse>(`/notifications/settings/${id}`, data),

  deleteSetting: (id: string) =>
    apiClient.delete(`/notifications/settings/${id}`),

  send: (data: {
    channel: string
    eventType: string
    recipient: string
    subject: string
    content: string
  }) => apiClient.post('/notifications/send', data),

  logs: (params?: { page?: number; perPage?: number; channel?: string; status?: string }) =>
    apiClient.get<PaginatedResponse<NotificationLogResponse>>('/notifications/logs', { params }),
}
