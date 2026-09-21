/**
 * Business analytics API client (P3).
 *
 * Every filter lands in the backend query — no client-only filtering (§4.1).
 * buildOverviewQuery is pure so filter → request-params is unit-testable.
 */
import { apiClient } from '@/lib/api-client'
import type {
  AnalyticsFilters,
  OverviewResponse,
  ProductAnalyticsFilters,
  ProductDetailResponse,
  ProductsResponse,
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
