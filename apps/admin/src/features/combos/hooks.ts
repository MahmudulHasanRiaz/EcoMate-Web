import { useQuery } from '@tanstack/react-query'
import { combosApi } from './api'

export function useCombosQuery(query: {
  page?: number; perPage?: number; search?: string;
  sort?: string; order?: string;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['combos', query],
    queryFn: () => combosApi.list(query).then((r) => r.data),
  })
  return { data, isLoading, isError, error }
}
