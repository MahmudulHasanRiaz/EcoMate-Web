import { useQuery } from '@tanstack/react-query'
import { businessAnalyticsApi, overviewQueryKey } from './api'
import type { AnalyticsFilters } from './types'

export function useBusinessOverview(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: overviewQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getOverview(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}
