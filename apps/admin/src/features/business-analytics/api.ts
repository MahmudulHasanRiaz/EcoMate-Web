/**
 * Business analytics API client (P3).
 *
 * Every filter lands in the backend query — no client-only filtering (§4.1).
 * buildOverviewQuery is pure so filter → request-params is unit-testable.
 */
import { apiClient } from '@/lib/api-client'
import type { AnalyticsFilters, OverviewResponse } from './types'

const FILTER_KEYS: (keyof AnalyticsFilters)[] = [
  'preset',
  'startDate',
  'endDate',
  'granularity',
  'source',
  'salesChannel',
  'marketingSource',
  'paymentMethod',
  'categoryId',
  'location',
  'customerSegment',
  'deliveryOutcome',
  'collectionStatus',
]

/** Filters → backend query params. Empty values are dropped, never sent. */
export function buildOverviewQuery(filters: AnalyticsFilters): Record<string, string> {
  const params: Record<string, string> = {}
  for (const key of FILTER_KEYS) {
    const v = filters[key]
    if (v !== undefined && v !== null && v !== '') {
      params[key] = v
    }
  }
  return params
}

/** Stable query key — every filter participates, so every filter changes the request. */
export function overviewQueryKey(filters: AnalyticsFilters) {
  return ['business-analytics-overview', buildOverviewQuery(filters)] as const
}

export const businessAnalyticsApi = {
  getOverview: (filters: AnalyticsFilters) =>
    apiClient.get<OverviewResponse>('/business-analytics/overview', {
      params: buildOverviewQuery(filters),
    }),
}
