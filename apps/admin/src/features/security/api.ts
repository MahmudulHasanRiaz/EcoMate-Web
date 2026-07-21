import { apiClient } from '@/lib/api-client'
import type {
  DashboardSummary,
  EventTimelineResponse,
  TrendResponse,
  TopOffendersResponse,
  BlockActivityResponse,
  EventDetailResponse,
  CorrelationNode,
  RetentionConfigResponse,
} from './types'

export const securityApi = {
  getSummary: () =>
    apiClient.get<DashboardSummary>('/admin/security/dashboard/summary').then((r) => r.data),

  getTimeline: (params?: {
    limit?: number
    cursor?: string
    severity?: string
    category?: string
    eventType?: string
  }) =>
    apiClient
      .get<EventTimelineResponse>('/admin/security/dashboard/timeline', { params })
      .then((r) => r.data),

  getTrends: (params: {
    interval: 'hourly' | 'daily'
    from?: string
    to?: string
    severity?: string
    eventType?: string
    category?: string
  }) =>
    apiClient
      .get<TrendResponse>('/admin/security/dashboard/trends', { params })
      .then((r) => r.data),

  getTopOffenders: (params?: {
    window?: '1h' | '24h' | '7d'
    limit?: number
    actorType?: string
  }) =>
    apiClient
      .get<TopOffendersResponse>('/admin/security/dashboard/top-offenders', { params })
      .then((r) => r.data),

  getBlockActivity: (params?: { from?: string; to?: string }) =>
    apiClient
      .get<BlockActivityResponse>('/admin/security/dashboard/block-activity', { params })
      .then((r) => r.data),

  getEventDetail: (id: string) =>
    apiClient.get<EventDetailResponse>(`/admin/security/dashboard/events/${id}`).then((r) => r.data),

  getCorrelationChain: (id: string) =>
    apiClient
      .get<CorrelationNode[]>(`/admin/security/dashboard/events/${id}/chain`)
      .then((r) => r.data),

  getRetentionConfig: () =>
    apiClient
      .get<RetentionConfigResponse>('/admin/security/dashboard/retention')
      .then((r) => r.data),

  updateRetentionPolicy: (data: {
    category: string
    severity: string
    retentionDays: number
    criticalRetentionDays?: number | null
  }) => apiClient.put('/admin/security/dashboard/retention', data).then((r) => r.data),
}
