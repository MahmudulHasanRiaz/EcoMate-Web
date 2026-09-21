/**
 * Business analytics API client (P3).
 *
 * Every filter lands in the backend query — no client-only filtering (§4.1).
 * buildOverviewQuery is pure so filter → request-params is unit-testable.
 */
import { apiClient } from '@/lib/api-client'
import type {
  AnalyticsFilters,
  CustomerCohortsResponse,
  CustomersListResponse,
  CustomersSummaryResponse,
  InventoryLedgerResponse,
  InventoryMovementResponse,
  InventoryStockoutsResponse,
  InventoryValueResponse,
  MarketingCampaignsResponse,
  MarketingSummaryResponse,
  MarketingUndatedResponse,
  OverviewResponse,
  ProductAnalyticsFilters,
  ProductDetailResponse,
  ProductsResponse,
  SalesSettlementResponse,
  SalesSummaryResponse,
  UncostedResponse,
} from './types'

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
  getProducts: (filters: ProductAnalyticsFilters) =>
    apiClient.get<ProductsResponse>('/business-analytics/products', {
      params: buildProductsQuery(filters),
    }),
  getProductDetail: (id: string, filters: ProductAnalyticsFilters) =>
    apiClient.get<ProductDetailResponse>(`/business-analytics/products/${id}`, {
      params: buildProductsQuery(filters),
    }),
  getUncostedProducts: (filters: ProductAnalyticsFilters) =>
    apiClient.get<UncostedResponse>('/business-analytics/products/uncosted', {
      params: buildProductsQuery(filters),
    }),
  getSalesSummary: (filters: AnalyticsFilters) =>
    apiClient.get<SalesSummaryResponse>('/business-analytics/sales/summary', {
      params: buildOverviewQuery(filters),
    }),
  getSalesFunnel: (filters: AnalyticsFilters) =>
    apiClient.get<{ data: { stages: SalesSummaryResponse['data']['funnel'] } }>('/business-analytics/sales/funnel', {
      params: buildOverviewQuery(filters),
    }),
  getSalesPipeline: (filters: AnalyticsFilters) =>
    apiClient.get<{ data: SalesSummaryResponse['data']['pipeline'] }>('/business-analytics/sales/pipeline', {
      params: buildOverviewQuery(filters),
    }),
  getSalesSettlement: (filters: AnalyticsFilters, page: number, pageSize: number) =>
    apiClient.get<SalesSettlementResponse>('/business-analytics/sales/settlement', {
      params: { ...buildOverviewQuery(filters), page: String(page), pageSize: String(pageSize) },
    }),
  getCustomersSummary: (filters: AnalyticsFilters) =>
    apiClient.get<CustomersSummaryResponse>('/business-analytics/customers/summary', {
      params: buildOverviewQuery(filters),
    }),
  getCustomerCohorts: (filters: AnalyticsFilters) =>
    apiClient.get<CustomerCohortsResponse>('/business-analytics/customers/cohorts', {
      params: buildOverviewQuery(filters),
    }),
  getCustomers: (filters: AnalyticsFilters, page: number, pageSize: number, segment?: string) =>
    apiClient.get<CustomersListResponse>('/business-analytics/customers', {
      params: { ...buildOverviewQuery(filters), page: String(page), pageSize: String(pageSize), ...(segment ? { segment } : {}) },
    }),
  getMarketingSummary: (filters: AnalyticsFilters) =>
    apiClient.get<MarketingSummaryResponse>('/business-analytics/marketing/summary', {
      params: buildOverviewQuery(filters),
    }),
  getMarketingCampaigns: (filters: AnalyticsFilters) =>
    apiClient.get<MarketingCampaignsResponse>('/business-analytics/marketing/campaigns', {
      params: buildOverviewQuery(filters),
    }),
  getMarketingUndated: (filters: AnalyticsFilters, page: number, pageSize: number) =>
    apiClient.get<MarketingUndatedResponse>('/business-analytics/marketing/undated', {
      params: { ...buildOverviewQuery(filters), page: String(page), pageSize: String(pageSize) },
    }),
  getInventoryValue: (filters: AnalyticsFilters) =>
    apiClient.get<InventoryValueResponse>('/business-analytics/inventory/value', {
      params: buildInventoryQuery(filters),
    }),
  getInventoryMovement: (filters: AnalyticsFilters, page: number, pageSize: number) =>
    apiClient.get<InventoryMovementResponse>('/business-analytics/inventory/movement', {
      params: { ...buildInventoryQuery(filters), page: String(page), pageSize: String(pageSize) },
    }),
  getInventoryStockouts: (filters: AnalyticsFilters, page: number, pageSize: number) =>
    apiClient.get<InventoryStockoutsResponse>('/business-analytics/inventory/stockouts', {
      params: { ...buildInventoryQuery(filters), page: String(page), pageSize: String(pageSize) },
    }),
  getInventoryLedger: (filters: AnalyticsFilters, page: number, pageSize: number) =>
    apiClient.get<InventoryLedgerResponse>('/business-analytics/inventory/ledger', {
      params: { ...buildInventoryQuery(filters), page: String(page), pageSize: String(pageSize) },
    }),
}

/** Product list/detail params: shared dimensions + list-only search/sort/dir. */
export function buildProductsQuery(filters: ProductAnalyticsFilters): Record<string, string> {
  const params = buildOverviewQuery(filters)
  for (const key of ['search', 'sort', 'dir'] as const) {
    const v = filters[key]
    if (v !== undefined && v !== null && v !== '') {
      params[key] = v
    }
  }
  return params
}

/** Stable product query key — shared dims plus search/sort participate. */
export function productsQueryKey(filters: ProductAnalyticsFilters) {
  return ['business-analytics-products', buildProductsQuery(filters)] as const
}

export function productDetailQueryKey(id: string, filters: ProductAnalyticsFilters) {
  return ['business-analytics-products', id, buildProductsQuery(filters)] as const
}

export function uncostedProductsQueryKey(filters: ProductAnalyticsFilters) {
  return ['business-analytics-products-uncosted', buildProductsQuery(filters)] as const
}

/** Stable sales query keys — shared dims drive summary/funnel/pipeline; settlement adds page/pageSize. */
export function salesSummaryQueryKey(filters: AnalyticsFilters) {
  return ['business-analytics-sales-summary', buildOverviewQuery(filters)] as const
}

export function salesSettlementQueryKey(filters: AnalyticsFilters, page: number, pageSize: number) {
  return ['business-analytics-sales-settlement', buildOverviewQuery(filters), page, pageSize] as const
}

/** Stable customer query keys — shared dims drive summary/cohorts; list adds page/pageSize/segment. */
export function customersSummaryQueryKey(filters: AnalyticsFilters) {
  return ['business-analytics-customers-summary', buildOverviewQuery(filters)] as const
}
export function customerCohortsQueryKey(filters: AnalyticsFilters) {
  return ['business-analytics-customers-cohorts', buildOverviewQuery(filters)] as const
}

export function customersListQueryKey(filters: AnalyticsFilters, page: number, pageSize: number, segment?: string) {
  return ['business-analytics-customers-list', buildOverviewQuery(filters), page, pageSize, segment ?? ''] as const
}

/** Stable marketing query keys — shared dims drive summary/campaigns; undated adds page/pageSize. */
export function marketingSummaryQueryKey(filters: AnalyticsFilters) {
  return ['business-analytics-marketing-summary', buildOverviewQuery(filters)] as const
}

export function marketingCampaignsQueryKey(filters: AnalyticsFilters) {
  return ['business-analytics-marketing-campaigns', buildOverviewQuery(filters)] as const
}

export function marketingUndatedQueryKey(filters: AnalyticsFilters, page: number, pageSize: number) {
  return ['business-analytics-marketing-undated', buildOverviewQuery(filters), page, pageSize] as const
}

/** Inventory pages add the warehouse scope + the P8 drill narrow (§4.1/§4.2). */
const INVENTORY_FILTER_KEYS: (keyof AnalyticsFilters)[] = [
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
  'warehouseId',
  'productId',
  'variantId',
]

/** Inventory filters → backend query params. Empty values are dropped, never sent. */
export function buildInventoryQuery(filters: AnalyticsFilters): Record<string, string> {
  const params: Record<string, string> = {}
  for (const key of INVENTORY_FILTER_KEYS) {
    const v = filters[key]
    if (v !== undefined && v !== null && v !== '') {
      params[key] = v
    }
  }
  return params
}

/** Stable inventory query keys — warehouse scope participates, so it changes the request. */
export function inventoryValueQueryKey(filters: AnalyticsFilters) {
  return ['business-analytics-inventory-value', buildInventoryQuery(filters)] as const
}

export function inventoryMovementQueryKey(filters: AnalyticsFilters, page: number, pageSize: number) {
  return ['business-analytics-inventory-movement', buildInventoryQuery(filters), page, pageSize] as const
}

export function inventoryStockoutsQueryKey(filters: AnalyticsFilters, page: number, pageSize: number) {
  return ['business-analytics-inventory-stockouts', buildInventoryQuery(filters), page, pageSize] as const
}

export function inventoryLedgerQueryKey(filters: AnalyticsFilters, page: number, pageSize: number) {
  return ['business-analytics-inventory-ledger', buildInventoryQuery(filters), page, pageSize] as const
}
