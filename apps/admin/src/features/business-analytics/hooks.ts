import { useQuery } from '@tanstack/react-query'
import {
  businessAnalyticsApi,
  overviewQueryKey,
  productDetailQueryKey,
  productsQueryKey,
  salesSettlementQueryKey,
  salesSummaryQueryKey,
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

export function useSalesSummary(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: salesSummaryQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getSalesSummary(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useSalesSettlement(filters: AnalyticsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: salesSettlementQueryKey(filters, page, pageSize),
    queryFn: () => businessAnalyticsApi.getSalesSettlement(filters, page, pageSize).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}
