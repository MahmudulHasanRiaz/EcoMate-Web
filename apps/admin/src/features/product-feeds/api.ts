import { apiClient } from '@/lib/api-client'

export interface FeedConfig {
  id: string
  platform: string
  secureToken: string
  isActive: boolean
  excludeOutOfStock: boolean
  minPriceFilter: number | null
  lastFetchedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FeedLog {
  id: string
  platform: string
  ipAddress: string
  durationMs: number
  statusCode: number
  fetchedAt: string
}

export const feedApi = {
  listConfigs: () =>
    apiClient.get<FeedConfig[]>('/v1/feeds/config').then((r) => r.data),

  createConfig: (data: { platform: string; excludeOutOfStock?: boolean; minPriceFilter?: number }) =>
    apiClient.post<FeedConfig>('/v1/feeds/config', data).then((r) => r.data),

  updateConfig: (id: string, data: { isActive?: boolean; excludeOutOfStock?: boolean; minPriceFilter?: number }) =>
    apiClient.post<FeedConfig>(`/v1/feeds/config/${id}`, data).then((r) => r.data),

  regenerateToken: (id: string) =>
    apiClient.post<FeedConfig>(`/v1/feeds/config/${id}/regenerate-token`).then((r) => r.data),

  getLogs: (platform?: string) =>
    apiClient.get<FeedLog[]>('/v1/feeds/logs', { params: platform ? { platform } : {} }).then((r) => r.data),
}
