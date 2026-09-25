/**
 * P4 frontend tests (§2.6 product P&L + §7.2 products items).
 *
 * basis labels (direct/allocated/attributed) · contribution-floor statement
 * verbatim · low-margin drill-down · return-rate incidence labelling ·
 * KpiValue states in product cells · filter → query-key → request-params for
 * search/sort/dir · uncosted fix-list order drill-down.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductPnlTable, PnlCell } from '../components/ProductPnlTable'
import { ContributionFloor } from '../components/ContributionFloor'
import { UncostedFixList } from '../components/UncostedFixList'
import { BasisBadge } from '../components/ProductBasisBadge'
import { buildProductsQuery, productsQueryKey, productDetailQueryKey } from '../api'
import { productVariantOrdersHref } from '../product-detail'
import ProductAnalytics, { ProductTotalsBand } from '../products'
import type { OverviewMeta, ProductsResponse } from '../types'
import {
  PRODUCT_CONTRIBUTION_FLOOR_STATEMENT,
  RETURN_INCIDENCE_LABEL,
  type KpiValue,
  type ProductAnalyticsFilters,
  type ProductPnlRow,
  type UncostedData,
} from '../types'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function kpi(value: number | null, state: KpiValue['state'] = 'ok', extra: Partial<KpiValue> = {}): KpiValue {
  return { value, state, ...extra }
}

function row(over: Partial<ProductPnlRow> = {}): ProductPnlRow {
  return {
    productId: 'p1',
    name: 'Smoke Product',
    stock: 40,
    movementClass: 'Normal',
    doi: 12.5,
    lowMargin: false,
    gross: kpi(10000, 'ok', { basis: 'direct' }),
    discounts: kpi(1000, 'ok', { basis: 'direct' }),
    returns: kpi(0, 'zero'),
    netSales: kpi(9000, 'ok', { basis: 'direct' }),
    units: kpi(18, 'ok', { basis: 'direct' }),
    cogs: kpi(3600, 'ok', { basis: 'direct' }),
    marketing: kpi(500, 'ok', { basis: 'attributed' }),
    fulfillment: kpi(600, 'ok', { basis: 'allocated' }),
    fees: kpi(90, 'ok', { basis: 'allocated' }),
    contribution: kpi(4210, 'ok'),
    contributionMargin: 0.4678,
    recognisedOrders: 9,
    returnOrders: 1,
    returnRate: { value: 1 / 9, state: 'ok', reason: RETURN_INCIDENCE_LABEL },
    uncostedUnits: 0,
    uncostedLines: 0,
    ...over,
  }
}

// ─── basis labels ────────────────────────────────────────────────────────────

describe('ProductPnlTable basis labels', () => {
  it('labels every line direct / attributed / allocated (§2.6)', async () => {
    const { container, getByText } = await renderWithClient(
      <ProductPnlTable title="T" rows={[row()]} detailHref={(r) => `/mon/analytics/products/${r.productId}`} />,
    )
    const text = container.textContent ?? ''
    expect(text).toMatch(/direct/)
    expect(text).toMatch(/attributed/)
    expect(text).toMatch(/allocated/)
    await expect.element(getByText('Marketing', { exact: false }).first()).toBeInTheDocument()
    const badges = [...container.querySelectorAll('[title*="order’s own lines"]')]
    expect(badges.length).toBeGreaterThan(0)
  })

  it('renders the three BasisBadge variants with honest tooltips', async () => {
    const direct = await renderWithClient(<BasisBadge basis="direct" />)
    await expect.element(direct.getByText('direct', { exact: true })).toBeInTheDocument()
    const attributed = await renderWithClient(<BasisBadge basis="attributed" />)
    await expect.element(attributed.getByText('attributed', { exact: true })).toBeInTheDocument()
    const allocated = await renderWithClient(<BasisBadge basis="allocated" />)
    await expect.element(allocated.getByText('allocated', { exact: true })).toBeInTheDocument()
  })
})

// ─── contribution floor, verbatim ────────────────────────────────────────────

describe('ContributionFloor', () => {
  it('states the floor verbatim (§2.6 D6)', async () => {
    const { getByText, container } = await renderWithClient(<ContributionFloor />)
    await expect.element(getByText(PRODUCT_CONTRIBUTION_FLOOR_STATEMENT, { exact: true })).toBeInTheDocument()
    expect(container.querySelector('[data-testid="contribution-floor"]')).not.toBeNull()
  })
})

// ─── low-margin drill-down (§4.2) ────────────────────────────────────────────

describe('low-margin drill-down', () => {
  it('links low-margin rows to the product detail', async () => {
    const { container } = await renderWithClient(
      <ProductPnlTable
        title="T"
        rows={[row({ productId: 'p-low', lowMargin: true, contributionMargin: 0.04 }), row({ productId: 'p-ok' })]}
        detailHref={(r) => `/mon/analytics/products/${r.productId}`}
      />,
    )
    const lowLinks = [...container.querySelectorAll('a[href="/mon/analytics/products/p-low"]')]
    expect(lowLinks.length).toBeGreaterThan(0)
    expect(lowLinks.some((a) => (a.textContent ?? '').includes('Low margin'))).toBe(true)
    const okRowLow = container.querySelector('a[href="/mon/analytics/products/p-ok"]')
    expect(okRowLow).not.toBeNull()
    expect(okRowLow?.textContent ?? '').not.toMatch(/Low margin/)
  })
})

// ─── return-rate incidence labelling ─────────────────────────────────────────

describe('return-rate incidence', () => {
  it('labels the rate as order-level incidence, never fractional', async () => {
    const { container, getByText } = await renderWithClient(
      <ProductPnlTable title="T" rows={[row()]} detailHref={(r) => `/mon/analytics/products/${r.productId}`} />,
    )
    await expect.element(getByText('(incidence)', { exact: false }).first()).toBeInTheDocument()
    const cell = container.querySelector(`td[title="${RETURN_INCIDENCE_LABEL}"]`)
    expect(cell).not.toBeNull()
    expect(cell?.textContent ?? '').toMatch(/11\.1%/)
  })

  it('renders N/A (never 0%) when the product has no recognised orders', async () => {
    const { container } = await renderWithClient(
      <ProductPnlTable
        title="T"
        rows={[row({ returnRate: { value: null, state: 'no_data', reason: 'no recognised orders containing this product' } })]}
        detailHref={(r) => `/mon/analytics/products/${r.productId}`}
      />,
    )
    expect(container.textContent ?? '').toMatch(/N\/A/)
    expect(container.textContent ?? '').not.toMatch(/0\.0%/)
  })
})

// ─── KpiValue states in product cells ────────────────────────────────────────

describe('PnlCell states', () => {
  it('renders unavailable as words with the reason — never ৳0', async () => {
    const { getByText } = await renderWithClient(
      <PnlCell kpi={kpi(4210, 'unavailable', { reason: '2 unit(s) without costSnapshot — see uncosted fix-list' })} />,
    )
    await expect.element(getByText('Unavailable', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳0', { exact: true })).not.toBeInTheDocument()
  })

  it('renders not_applicable as "—", no_data and zero distinctly', async () => {
    const na = await renderWithClient(<PnlCell kpi={{ value: null, state: 'not_applicable' }} />)
    await expect.element(na.getByText('—', { exact: true })).toBeInTheDocument()
    const nd = await renderWithClient(<PnlCell kpi={{ value: null, state: 'no_data' }} />)
    await expect.element(nd.getByText('No data', { exact: true })).toBeInTheDocument()
    const z = await renderWithClient(<PnlCell kpi={{ value: 0, state: 'zero' }} />)
    await expect.element(z.getByText('৳0', { exact: true })).toBeInTheDocument()
  })
})

// ─── filter → query-key → request-params ─────────────────────────────────────

describe('products filter → query-key → request-params', () => {
  it('carries search/sort/dir into params and keys, drops empties, never a Store', () => {
    const f: ProductAnalyticsFilters = { preset: 'last_30_days', search: 'smoke', sort: 'margin', dir: 'asc' }
    expect(buildProductsQuery(f)).toMatchObject({ preset: 'last_30_days', search: 'smoke', sort: 'margin', dir: 'asc' })
    expect(buildProductsQuery({ preset: 'last_30_days', search: '' })).not.toHaveProperty('search')
    const q = buildProductsQuery(f)
    expect('store' in q).toBe(false)
    expect('storeId' in q).toBe(false)
    expect(JSON.stringify(productsQueryKey(f))).not.toBe(JSON.stringify(productsQueryKey({ preset: 'last_30_days' })))
    expect(JSON.stringify(productDetailQueryKey('p1', f))).toContain('p1')
  })

  it('keeps every shared dimension in the products key', () => {
    const base: ProductAnalyticsFilters = { preset: 'last_30_days' }
    const next = { ...base, salesChannel: 'WEBSITE', categoryId: 'c9' }
    expect(JSON.stringify(productsQueryKey(next))).not.toBe(JSON.stringify(productsQueryKey(base)))
    expect(buildProductsQuery(next)).toMatchObject({ salesChannel: 'WEBSITE', categoryId: 'c9' })
  })
})

// ─── product-detail variant rows propagate filter params (§4.2) ─────────────

describe('productVariantOrdersHref', () => {
  it('propagates the current filters plus the row product scope — never a bare /op/orders', () => {
    const f: ProductAnalyticsFilters = { preset: 'last_30_days', salesChannel: 'WEBSITE' }
    const href = productVariantOrdersHref(f, { productId: 'p1', variantId: null })
    expect(href).toMatch(/^\/op\/orders\?/)
    expect(href).toContain('preset=last_30_days')
    expect(href).toContain('salesChannel=WEBSITE')
    expect(href).toContain('productId=p1')
    expect(href).not.toContain('variantId')
  })

  it('carries the variant scope and the custom date window', () => {
    const f: ProductAnalyticsFilters = { preset: 'custom', startDate: '2026-09-01', endDate: '2026-09-07' }
    const href = productVariantOrdersHref(f, { productId: 'p1', variantId: 'v9' })
    expect(href).toContain('productId=p1')
    expect(href).toContain('variantId=v9')
    expect(href).toContain('startDate=2026-09-01')
    expect(href).toContain('endDate=2026-09-07')
  })

  it('drops product-list-only search/sort/dir from the orders drill', () => {
    const f: ProductAnalyticsFilters = { preset: 'last_30_days', search: 'smoke', sort: 'margin', dir: 'asc' }
    const href = productVariantOrdersHref(f, { productId: 'p1', variantId: null })
    expect(href).toContain('productId=p1')
    expect(href).not.toContain('search=')
    expect(href).not.toMatch(/[?&]sort=/)
    expect(href).not.toMatch(/[?&]dir=/)
  })
})

// ─── uncosted fix-list ───────────────────────────────────────────────────────

const uncosted: UncostedData = {
  rows: [
    { orderId: 'o1', orderItemId: 'li1', productId: 'p1', variantId: null, quantity: 2, lineNet: 1000, productName: 'Smoke Product', variantLabel: 'Simple product' },
  ],
  totals: { units: 2, lines: 1 },
}

describe('UncostedFixList', () => {
  it('states the no-fallback rule and drills each line to its order', async () => {
    const { container, getByText } = await renderWithClient(<UncostedFixList uncosted={uncosted} />)
    await expect.element(getByText(/never a fallback/)).toBeInTheDocument()
    const link = container.querySelector('a[href="/op/orders/o1"]')
    expect(link).not.toBeNull()
  })

  it('renders the empty state when nothing is uncosted', async () => {
    const { getByText } = await renderWithClient(<UncostedFixList uncosted={{ rows: [], totals: { units: 0, lines: 0 } }} />)
    await expect.element(getByText('No uncosted lines', { exact: true })).toBeInTheDocument()
  })
})

// ─── W2 polish: totals KpiCards, basis legend, sticky col, footer ────────────

const productsMocks = vi.hoisted(() => ({
  products: undefined as unknown as ProductsResponse,
}))

vi.mock('@/features/business-analytics/hooks', () => ({
  useAnalyticsProducts: () => ({ data: productsMocks.products, isLoading: false, error: undefined, refetch: () => {} }),
  useAnalyticsProductDetail: () => ({ data: null, isLoading: false, error: undefined, refetch: () => {} }),
  useUncostedProducts: () => ({ data: null, isLoading: false, error: undefined }),
}))

vi.mock('@/features/categories/api', () => ({
  categoriesApi: { list: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}))

function productsFixture(): ProductsResponse {
  return {
    data: {
      rows: [row()],
      totals: { netSales: 9000, contribution: 4210, units: 18 },
      uncosted: { units: 0, lines: 0 },
      contributionFloor: PRODUCT_CONTRIBUTION_FLOOR_STATEMENT,
    },
    meta: {
      range: { start: '2026-09-01', end: '2026-09-07', periodDays: 7 },
      comparison: { prevStart: '2026-08-25', prevEnd: '2026-08-31' },
      filters: {},
      granularity: 'day',
      generatedAt: '2026-09-07T00:00:00.000Z',
      dataAsOf: '2026-09-07',
      formulaVersion: 'v9',
      recognition: 'delivered-only',
      costCoverage: {
        cogs: { actualPct: 100, estimatedPct: 0, unavailableUnits: 0, unavailableItems: 0 },
        shipping: { actualOrders: 9, estimatedOrders: 0, unavailableOrders: 0 },
        fees: { paidPayments: 9, withFee: 9, withoutFee: 0 },
        marketing: { datedRows: 1, undatedRows: 0, datedAmount: 500, undatedAmount: 0 },
        delivery: { onlineOrders: 9, codOrders: 0, collectionUnavailableOrders: 0 },
      },
      ladderState: 'actual',
      thresholds: {},
      dateBasis: 'Delivered transition',
    } satisfies OverviewMeta as OverviewMeta,
  }
}

describe('ProductTotalsBand (W2 KpiCard idiom)', () => {
  it('renders Σ totals as KpiCards carrying the formula version', async () => {
    const { container, getByText, getByRole } = await renderWithClient(
      <ProductTotalsBand totals={{ netSales: 9000, contribution: 4210, units: 18 }} formulaVersion="v9" />,
    )
    await expect.element(getByText('Net Sales (Σ products)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳9,000', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Contribution (Σ products)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Units recognised', { exact: true })).toBeInTheDocument()
    // Formula disclosure restored on every card.
    await userEvent.click(getByRole('button', { name: 'About Net Sales (Σ products)' }))
    const text = container.textContent ?? ''
    expect(text).toMatch(/Formula: v9/)
  })
})

describe('ProductPnlTable basis legend + sticky column (W2)', () => {
  it('states the column→basis mapping once above the table, not per column', async () => {
    const { container } = await renderWithClient(
      <ProductPnlTable title="T" rows={[row()]} detailHref={(r) => `/mon/analytics/products/${r.productId}`} />,
    )
    const legend = container.querySelector('[data-testid="pnl-basis-legend"]')?.textContent ?? ''
    expect(legend).toMatch(/direct/)
    expect(legend).toMatch(/attributed/)
    expect(legend).toMatch(/allocated/)
    expect(legend).toMatch(/Marketing/)
    expect(legend).toMatch(/Fulfillment/)
    // Headers carry no per-column badges anymore.
    const thead = container.querySelector('thead')?.textContent ?? ''
    expect(thead).not.toMatch(/direct/)
    expect(thead).not.toMatch(/attributed/)
    expect(thead).not.toMatch(/allocated/)
  })

  it('pins the first column for wide-table sideways scroll', async () => {
    const { container } = await renderWithClient(
      <ProductPnlTable title="T" rows={[row()]} detailHref={(r) => `/mon/analytics/products/${r.productId}`} />,
    )
    const firstHead = container.querySelector('thead th')
    expect(firstHead?.className).toMatch(/sticky/)
    const firstCell = container.querySelector('tbody td')
    expect(firstCell?.className).toMatch(/sticky/)
  })
})

describe('PnlCell estimated wording (W2)', () => {
  it('labels estimated cells "Estimated" like every other badge', async () => {
    const { container, getByText } = await renderWithClient(
      <PnlCell kpi={kpi(4210, 'estimated')} />,
    )
    await expect.element(getByText('Estimated', { exact: true })).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/Est\b/)
  })
})

describe('products page (W2)', () => {
  it('bands totals, controls, table in order with a single meta footer', async () => {
    productsMocks.products = productsFixture()
    const { container, getByText, getByTestId } = await renderWithClient(<ProductAnalytics />)
    await expect.element(getByText('Product Analytics', { exact: true })).toBeInTheDocument()
    await expect.element(getByTestId('product-totals')).toBeInTheDocument()
    await expect.element(getByTestId('product-table-controls')).toBeInTheDocument()
    // Table-header-adjacent controls: totals → controls → table.
    const html = container.innerHTML
    expect(html.indexOf('product-totals')).toBeLessThan(html.indexOf('product-table-controls'))
    expect(html.indexOf('product-table-controls')).toBeLessThan(html.indexOf('pnl-basis-legend'))
    const text = container.textContent ?? ''
    expect((text.match(/Formula v9 ·/g) ?? []).length).toBe(1)
  })
})
