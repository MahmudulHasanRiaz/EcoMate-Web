import { apiClient } from '@/lib/api-client'
import type { SalesKpi, RevenueTrend, MarketingKpi, TrafficSources, StatusCount, RevenueByMethod, TopProduct, DateRangeParams } from './types'

function qp(p: DateRangeParams): string {
  const params = new URLSearchParams()
  if (p.startDate) params.set('startDate', p.startDate)
  if (p.endDate) params.set('endDate', p.endDate)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const analyticsApi = {
  getSalesKpi: (range?: DateRangeParams) =>
    apiClient.get<SalesKpi>(`/analytics/sales-kpi${qp(range || {})}`),
  getRevenueTrend: (range?: DateRangeParams) =>
    apiClient.get<RevenueTrend>(`/analytics/revenue-trend${qp(range || {})}`),
  getMarketingKpi: (range?: DateRangeParams) =>
    apiClient.get<MarketingKpi>(`/analytics/marketing-kpi${qp(range || {})}`),
  getTrafficSources: (range?: DateRangeParams) =>
    apiClient.get<TrafficSources>(`/analytics/traffic-sources${qp(range || {})}`),
  getOrderStatusDistribution: (range?: DateRangeParams) =>
    apiClient.get<StatusCount[]>(`/dashboard/order-status-distribution${qp(range || {})}`),
  getRevenueByPayment: (range?: DateRangeParams) =>
    apiClient.get<RevenueByMethod[]>(`/dashboard/revenue-by-payment${qp(range || {})}`),
  getTopProducts: (range?: DateRangeParams) =>
    apiClient.get<TopProduct[]>(`/dashboard/top-products${qp(range || {})}`),
}
