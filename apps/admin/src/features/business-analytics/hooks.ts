import { useQuery } from '@tanstack/react-query'
import {
  businessAnalyticsApi,
  overviewQueryKey,
  productDetailQueryKey,
  productsQueryKey,
  uncostedProductsQueryKey,
} from './api'
import type { AnalyticsFilters, ProductAnalyticsFilters } from './types'

export function useBusinessOverview(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: overviewQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getOverview(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useAnalyticsProducts(filters: ProductAnalyticsFilters) {
  return useQuery({
    queryKey: productsQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getProducts(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useAnalyticsProductDetail(id: string, filters: ProductAnalyticsFilters) {
  return useQuery({
    queryKey: productDetailQueryKey(id, filters),
    queryFn: () => businessAnalyticsApi.getProductDetail(id, filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useUncostedProducts(filters: ProductAnalyticsFilters) {
  return useQuery({
    queryKey: uncostedProductsQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getUncostedProducts(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}
