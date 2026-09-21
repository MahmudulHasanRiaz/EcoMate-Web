import { useQuery } from '@tanstack/react-query'
import {
  businessAnalyticsApi,
  customerCohortsQueryKey,
  customersListQueryKey,
  customersSummaryQueryKey,
  expensesCategoriesQueryKey,
  expensesListQueryKey,
  expensesSummaryQueryKey,
  expensesTrendQueryKey,
  inventoryLedgerQueryKey,
  inventoryMovementQueryKey,
  inventoryStockoutsQueryKey,
  inventoryValueQueryKey,
  marketingCampaignsQueryKey,
  marketingSummaryQueryKey,
  marketingUndatedQueryKey,
  overviewQueryKey,
  productDetailQueryKey,
  productsQueryKey,
  salesSettlementQueryKey,
  salesSummaryQueryKey,
  uncostedProductsQueryKey,
} from './api'
import type { AnalyticsFilters, ExpenseAnalyticsFilters, ProductAnalyticsFilters } from './types'

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

export function useCustomersSummary(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: customersSummaryQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getCustomersSummary(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useCustomerCohorts(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: customerCohortsQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getCustomerCohorts(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useCustomersList(filters: AnalyticsFilters, page: number, pageSize: number, segment?: string) {
  return useQuery({
    queryKey: customersListQueryKey(filters, page, pageSize, segment),
    queryFn: () => businessAnalyticsApi.getCustomers(filters, page, pageSize, segment).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useMarketingSummary(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: marketingSummaryQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getMarketingSummary(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useMarketingCampaigns(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: marketingCampaignsQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getMarketingCampaigns(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useMarketingUndated(filters: AnalyticsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: marketingUndatedQueryKey(filters, page, pageSize),
    queryFn: () => businessAnalyticsApi.getMarketingUndated(filters, page, pageSize).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useInventoryValue(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: inventoryValueQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getInventoryValue(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useInventoryMovement(filters: AnalyticsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: inventoryMovementQueryKey(filters, page, pageSize),
    queryFn: () => businessAnalyticsApi.getInventoryMovement(filters, page, pageSize).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useInventoryStockouts(filters: AnalyticsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: inventoryStockoutsQueryKey(filters, page, pageSize),
    queryFn: () => businessAnalyticsApi.getInventoryStockouts(filters, page, pageSize).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useInventoryLedger(filters: AnalyticsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: inventoryLedgerQueryKey(filters, page, pageSize),
    queryFn: () => businessAnalyticsApi.getInventoryLedger(filters, page, pageSize).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useExpensesSummary(filters: ExpenseAnalyticsFilters) {
  return useQuery({
    queryKey: expensesSummaryQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getExpensesSummary(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useExpensesTrend(filters: ExpenseAnalyticsFilters) {
  return useQuery({
    queryKey: expensesTrendQueryKey(filters),
    queryFn: () => businessAnalyticsApi.getExpensesTrend(filters).then((r) => r.data),
    refetchInterval: 60_000,
  })
}

export function useExpensesCategories(filters: ExpenseAnalyticsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: expensesCategoriesQueryKey(filters, page, pageSize),
    queryFn: () => businessAnalyticsApi.getExpensesCategories(filters, page, pageSize).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useExpensesList(filters: ExpenseAnalyticsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: expensesListQueryKey(filters, page, pageSize),
    queryFn: () => businessAnalyticsApi.getExpensesList(filters, page, pageSize).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}
