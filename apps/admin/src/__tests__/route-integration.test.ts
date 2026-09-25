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
import { Route as MonAnalyticsProductsRoute } from '../routes/_authenticated/mon/analytics/products/index'
import { Route as MonAnalyticsProductsIdRoute } from '../routes/_authenticated/mon/analytics/products/$id'
import ProductAnalytics from '../features/business-analytics/products'
import ProductAnalyticsDetail from '../features/business-analytics/product-detail'
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

describe('Product analytics detail route (nested-outlet regression)', () => {
  // TanStack file routing nests `products.$id.tsx` under `products.tsx`, and the
  // list parent renders no <Outlet/>, so the detail child was silently dropped:
  // `/mon/analytics/products/:id` rendered the PRODUCTS LIST. The established
  // repo pattern (op/products, op/orders) is sibling routes via
  // `products/index.tsx` + `products/$id.tsx`. These imports pin that convention:
  // re-nesting the files deletes these modules and fails this suite.
  it('list route renders the products LIST', () => {
    expect(MonAnalyticsProductsRoute.options.component).toBe(ProductAnalytics)
  })

  it('detail route renders the product DETAIL, not the list', () => {
    expect(MonAnalyticsProductsIdRoute.options.component).toBe(ProductAnalyticsDetail)
  })

  it('detail and list routes never resolve to the same component (detail URL must not render the list)', () => {
    // The reported symptom: `/mon/analytics/products/:id` rendered the LIST.
    // Distinct sibling route modules with distinct components pin the fix.
    // (Drill-href shape `/mon/analytics/products/${id}` is pinned by
    // products.test.tsx; detail rendering by product-detail.test.tsx.)
    expect(MonAnalyticsProductsIdRoute.options.component).not.toBe(MonAnalyticsProductsRoute.options.component)
  })
})
