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
    ['overview → Business Overview landing', OpAnalyticsOverviewRoute, {}],
    ['sales → Sales & Orders', OpAnalyticsSalesRoute, {}],
    ['products → Products', OpAnalyticsProductsRoute, {}],
    ['products/$id → product detail (params preserved)', OpAnalyticsProductsIdRoute, { params: { id: 'p1' } }],
    ['customers → Customers', OpAnalyticsCustomersRoute, {}],
    ['marketing → Marketing', OpAnalyticsMarketingRoute, {}],
    ['inventory → Inventory (search preserved)', OpAnalyticsInventoryRoute, { search: { view: 'ledger', productId: 'p1' } }],
    ['expenses → Expenses (search preserved)', OpAnalyticsExpensesRoute, { search: { view: 'list', categoryId: 'c1' } }],
  ])('%s', (_label, route, ctx) => {
    const fn = route.options.beforeLoad
    expect(fn).toBeDefined()
    try {
      fn!({ ...({} as any), ...ctx })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(isRedirect(e)).toBe(true)
    }
  })
})
