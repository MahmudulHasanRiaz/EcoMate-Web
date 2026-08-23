import { useQuery } from '@tanstack/react-query'
import { hrApi } from './api'

export function useHrOverviewQuery() {
  return useQuery({
    queryKey: ['hr-overview'],
    queryFn: hrApi.overview,
    refetchInterval: 60_000,
  })
}