import { describe, expect, it } from 'vitest'
import { managedStockOverviewParams } from '../stock-overview-params'

describe('managedStockOverviewParams (Stock page Managed-view request)', () => {
  it('always scopes the request with view=managed so the Managed tab lists only MANAGED_STOCK products', () => {
    const params = managedStockOverviewParams({ search: '', page: 1, perPage: 20, stockSort: null })
    expect(params.view).toBe('managed')
  })

  it('passes search/page/perPage through and omits blank search', () => {
    expect(managedStockOverviewParams({ search: 'hoodie', page: 3, perPage: 20, stockSort: null })).toEqual({
      search: 'hoodie',
      page: 3,
      perPage: 20,
      sortBy: undefined,
      sortOrder: undefined,
      view: 'managed',
    })
    expect(managedStockOverviewParams({ search: '', page: 1, perPage: 20, stockSort: null }).search).toBeUndefined()
  })

  it('maps the stock sort toggle to sortBy/sortOrder without dropping the scope', () => {
    const params = managedStockOverviewParams({ search: '', page: 1, perPage: 20, stockSort: 'desc' })
    expect(params.sortBy).toBe('stock')
    expect(params.sortOrder).toBe('desc')
    expect(params.view).toBe('managed')
  })
})
