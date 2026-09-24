import { describe, expect, it } from 'vitest'
import { Route as MonPresetsRoute } from '../routes/_authenticated/mon/users/presets'
import { Route as OpEmployeesPresetsRoute } from '../routes/_authenticated/op/employees/presets'
import { Route as HrPresetsRoute } from '../routes/_authenticated/hr/presets'
import AccessPresetsPage from '../features/access-presets'
import { Route as OpAnalyticsOverviewRoute } from '../routes/_authenticated/op/analytics/overview'
import { Route as OpAnalyticsSalesRoute } from '../routes/_authenticated/op/analytics/sales'
import { Route as OpAnalyticsProductsRoute } from '../routes/_authenticated/op/analytics/products'
import { Route as OpAnalyticsProductsIdRoute } from '../routes/_authenticated/op/analytics/products.$id'
import { Route as OpAnalyticsCustomersRoute } from '../routes/_authenticated/op/analytics/customers'
import { Route as OpAnalyticsMarketingRoute } from '../routes/_authenticated/op/analytics/marketing'
import { Route as OpAnalyticsInventoryRoute } from '../routes/_authenticated/op/analytics/inventory'
import { Route as OpAnalyticsExpensesRoute } from '../routes/_authenticated/op/analytics/expenses'
import { Route as MonAnalyticsLandingRoute } from '../routes/_authenticated/mon/analytics/index'
import BusinessOverview from '../features/business-analytics'
import { isRedirect } from '@tanstack/react-router'

function expectRedirect(fn: ((ctx: any) => unknown) | undefined) {
  expect(fn).toBeDefined()
  try {
    fn!({} as any)
    expect.unreachable('should have thrown')
  } catch (e) {
    expect(isRedirect(e)).toBe(true)
  }
}

function redirectOptions(fn: ((ctx: any) => unknown) | undefined, ctx: any = {}) {
  expect(fn).toBeDefined()
  try {
    fn!({ ...({} as any), ...ctx })
    expect.unreachable('should have thrown')
  } catch (e) {
    expect(isRedirect(e)).toBe(true)
    return (e as unknown as { options: { to?: string; search?: unknown; params?: unknown } }).options
  }
  throw new Error('unreachable')
}

describe('Access Preset Route Integration', () => {
  it('hr/presets route uses AccessPresetsPage component', () => {
    expect(HrPresetsRoute.options.component).toBe(AccessPresetsPage)
  })

  it.each([
    ['legacy mon/users/presets route', MonPresetsRoute],
    ['legacy op/employees/presets route', OpEmployeesPresetsRoute],
  ])('%s beforeLoad redirects to /hr/presets', (_label, route) => {
    expectRedirect(route.options.beforeLoad)
  })
})

describe('Analytics consolidation redirects (/op/analytics/* → /mon/analytics/*)', () => {
  it('Business Overview renders directly at /mon/analytics (no intermediate page)', () => {
    expect(MonAnalyticsLandingRoute.options.component).toBe(BusinessOverview)
  })
  it.each([
    ['overview → Business Overview landing', OpAnalyticsOverviewRoute, {}, { to: '/mon/analytics' }],
    ['sales → Sales & Orders', OpAnalyticsSalesRoute, {}, { to: '/mon/analytics/sales' }],
    ['products → Products', OpAnalyticsProductsRoute, {}, { to: '/mon/analytics/products' }],
    ['products/$id → product detail (params preserved)', OpAnalyticsProductsIdRoute, { params: { id: 'p1' } }, { to: '/mon/analytics/products/$id', params: { id: 'p1' } }],
    ['customers → Customers', OpAnalyticsCustomersRoute, {}, { to: '/mon/analytics/customers' }],
    ['marketing → Marketing', OpAnalyticsMarketingRoute, {}, { to: '/mon/analytics/marketing' }],
    ['inventory → Inventory (search preserved)', OpAnalyticsInventoryRoute, { search: { view: 'ledger', productId: 'p1' } }, { to: '/mon/analytics/inventory', search: { view: 'ledger', productId: 'p1' } }],
    ['expenses → Expenses (search preserved)', OpAnalyticsExpensesRoute, { search: { view: 'list', categoryId: 'c1' } }, { to: '/mon/analytics/expenses', search: { view: 'list', categoryId: 'c1' } }],
  ])('%s', (_label, route, ctx, expected) => {
    const options = redirectOptions(route.options.beforeLoad, ctx)
    expect(options.to).toBe(expected.to)
    if (expected.params !== undefined) expect(options.params).toEqual(expected.params)
    if (expected.search !== undefined) expect(options.search).toEqual(expected.search)
  })
})
