/**
 * Product detail frontend tests (W2 polish).
 *
 * Inventory relation as KpiCards (one idiom) · inventory link carries the
 * current filter params · empty uncosted renders a compact EmptyState instead
 * of the full fix-list card · counts stay as a compact line above the single
 * meta footer.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProductAnalyticsDetail, { InventoryRelationBand } from '../product-detail'
import { RETURN_INCIDENCE_LABEL, type KpiValue, type ProductDetailResponse, type ProductPnlRow } from '../types'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function kpi(value: number | null, state: KpiValue['state'] = 'ok', extra: Partial<KpiValue> = {}): KpiValue {
  return { value, state, ...extra }
}

const detailMocks = vi.hoisted(() => ({
  detail: undefined as unknown as ProductDetailResponse,
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'p1' }),
}))

vi.mock('@/features/business-analytics/hooks', () => ({
  useAnalyticsProductDetail: () => ({ data: detailMocks.detail, isLoading: false, error: undefined, refetch: () => {} }),
}))

vi.mock('@/features/categories/api', () => ({
  categoriesApi: { list: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}))

function parentRow(): ProductPnlRow {
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
  }
}

function detailFixture(): ProductDetailResponse {
  return {
    data: {
      product: { id: 'p1', name: 'Smoke Product', stock: 40, movementClass: 'Normal', doi: 12.5 },
      parent: parentRow(),
      variants: [],
      trend: { requestedGranularity: 'day', granularity: 'day', points: [] },
      uncosted: { units: 0, lines: 0, rows: [] },
      contributionFloor: 'Product P&L stops at Contribution. Company operating expenses are not allocated to products.',
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
    },
  }
}

describe('InventoryRelationBand (W2 one idiom)', () => {
  it('renders stock, movement and DOI without bare cards', async () => {
    const { container, getByText } = await renderWithClient(
      <InventoryRelationBand product={{ id: 'p1', name: 'Smoke', stock: 40, movementClass: 'Normal', doi: 12.5 }} />,
    )
    await expect.element(getByText('Stock on hand', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('40', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Movement class', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Normal', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Days of inventory', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('12.5', { exact: true })).toBeInTheDocument()
    // No bare text-2xl cards remain in the band.
    expect(container.querySelector('[data-testid="inventory-relation"] .text-2xl')).toBeNull()
  })

  it('renders an uncomputable DOI as "—", never a number', async () => {
    const { getByText } = await renderWithClient(
      <InventoryRelationBand product={{ id: 'p1', name: 'Smoke', stock: 40, movementClass: 'Dead', doi: null }} />,
    )
    await expect.element(getByText('—', { exact: true })).toBeInTheDocument()
  })
})

describe('product detail page (W2)', () => {
  it('links inventory with filter params, compacts empty uncosted, single footer', async () => {
    detailMocks.detail = detailFixture()
    const { container, getByText } = await renderWithClient(<ProductAnalyticsDetail />)
    await expect.element(getByText('Smoke Product', { exact: true })).toBeInTheDocument()
    // Inventory drill carries the current filter params — never a bare link.
    const inventory = [...container.querySelectorAll('a')].find((a) =>
      (a.getAttribute('title') ?? '').startsWith('Inventory relation'),
    )
    expect(inventory).not.toBeUndefined()
    expect(inventory?.getAttribute('href')).toContain('/op/inventory?')
    expect(inventory?.getAttribute('href')).toContain('preset=last_30_days')
    // Empty uncosted: compact empty state, no full fix-list card.
    await expect.element(getByText(/No uncosted lines/)).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/Uncosted lines fix-list/)
    // Counts stay as a compact line above the single meta footer.
    expect(container.textContent ?? '').toMatch(/Recognised orders: 9 · Return orders: 1/)
    expect((container.textContent?.match(/Formula v9 ·/g) ?? []).length).toBe(1)
  })
})
