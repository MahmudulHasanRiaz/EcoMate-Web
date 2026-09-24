import { apiClient } from '@/lib/api-client'
import type { MarketingKpi, TrafficSources, DateRangeParams } from './types'

function qp(p: DateRangeParams): string {
  const params = new URLSearchParams()
  if (p.startDate) params.set('startDate', p.startDate)
  if (p.endDate) params.set('endDate', p.endDate)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const analyticsApi = {
  getMarketingKpi: (range?: DateRangeParams) =>
    apiClient.get<MarketingKpi>(`/analytics/marketing-kpi${qp(range || {})}`),
  getTrafficSources: (range?: DateRangeParams) =>
    apiClient.get<TrafficSources>(`/analytics/traffic-sources${qp(range || {})}`),
}
