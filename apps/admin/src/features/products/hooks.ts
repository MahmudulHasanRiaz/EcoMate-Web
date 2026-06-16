import { useQuery } from '@tanstack/react-query'
import { productsApi } from './api'

export function useProductsQuery(query: {
  page?: number; perPage?: number; search?: string; type?: string;
  categoryId?: string; sort?: string; order?: string;
}) {
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['products', query],
    queryFn: () => productsApi.list(query).then((r) => r.data),
  })
  return { data, isLoading, isError, error, isFetching }
}
