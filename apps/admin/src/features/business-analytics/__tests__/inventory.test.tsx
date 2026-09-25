/**
 * P8 frontend tests (§7.2 inventory items).
 *
 * closing_only disclosure + reconstructedAt · turnover/DOI/sell-through
 * KpiValue states · movement policy label + rationale tooltip · drill params
 * (movement rows carry productId/variantId) · lost-sales honesty
 * (unavailable ≠ ৳0, estimated badge) · query keys carry the warehouse scope.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AgingTable,
  InventoryLedgerSection,
  LostSalesCard,
  MovementTable,
  TurnoverCards,
  ValueBasisBanner,
  inventoryLedgerHref,
  resolveInventoryDrill,
  resolveLedgerNames,
} from '../inventory'
import InventoryAnalytics from '../inventory'
import { businessAnalyticsApi } from '../api'
import { KpiCard } from '../components/KpiCard'
import { DrilldownPanel } from '../components/DrilldownPanel'
import {
  buildInventoryQuery,
  inventoryLedgerQueryKey,  inventoryMovementQueryKey,
  inventoryStockoutsQueryKey,
  inventoryValueQueryKey,
} from '../api'
import {
  INVENTORY_CLOSING_ONLY_NOTE,
  LOST_SALES_NOTE,
  MOVEMENT_POLICY_LABEL,
} from '../types'
import type {
  AnalyticsFilters,
  InventoryLedgerData,
  InventoryMovementData,
  InventoryStockoutsData,
  InventoryValueData,
  KpiValue,
} from '../types'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function kpi(over: Partial<KpiValue>): KpiValue {
  return { value: 1000, state: 'ok', ...over }
}

const FILTERS: AnalyticsFilters = { preset: 'last_30_days' }

function valueData(over: Partial<InventoryValueData> = {}): InventoryValueData {
  return {
    periodDays: 30,
    reconstructedAt: '2026-09-21T00:00:00.000Z',
    basis: 'reconstructed',
    basisNote: 'reconstructed',
    basisStatement: 'reconstructed from CostingLot history',
    value: {
      opening: kpi({ value: 800 }),
      closing: kpi({ value: 1000 }),
      average: kpi({ value: 900 }),
    },
    turnover: kpi({ value: 2 }),
    doi: kpi({ value: 15 }),
    cogs: { amount: 1800, dateBasis: 'Delivered transition' },
    aging: {
      buckets: [{ label: '0–30', minDays: 0, maxDays: 30, units: 50, value: 1000 }],
      dateBasis: 'CostingLot history',
    },
    coverage: { lots: 4, products: 2, inactiveExcluded: 0 },
    ...over,
  }
}

function movementData(): InventoryMovementData {
  return {
    periodDays: 30,
    reconstructedAt: '2026-09-21T00:00:00.000Z',
    policyLabel: MOVEMENT_POLICY_LABEL,
    policyRationale: 'Default 30/90-day policy rationale',
    rows: [
      {
        productId: 'p1',
        variantId: 'v1',
        name: 'Jar',
        unitsSold: 30,
        closingUnits: 30,
        doi: 30,
        movementClass: 'Fast',
        policyLabel: `Fast — ${MOVEMENT_POLICY_LABEL}`,
        sellThrough: 0.5,
        stockoutDays: 0,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }
}

function stockoutsData(over: Partial<InventoryStockoutsData> = {}): InventoryStockoutsData {
  return {
    periodDays: 30,
    reconstructedAt: '2026-09-21T00:00:00.000Z',
    stockoutDays: kpi({ value: 0, state: 'zero', reason: 'no day closed at stock ≤ 0' }),
    productsAffected: 0,
    lostSales: { value: null, state: 'unavailable', reason: 'no stock-out days in range' },
    lostSalesNote: LOST_SALES_NOTE,
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    ...over,
  }
}

// ─── closing_only disclosure ─────────────────────────────────────────────────

describe('ValueBasisBanner', () => {
  it('states the reconstruction basis with coverage in disclosure', async () => {
    const { container, getByText, getByRole, getByTestId } = await renderWithClient(<ValueBasisBanner value={valueData()} />)
    expect(container.querySelector('[data-testid="value-basis"]')).not.toBeNull()
    await expect.element(getByText('reconstructed', { exact: true })).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: 'About inventory coverage' }))
    await expect.element(getByTestId('value-coverage')).toHaveTextContent(/Reconstructed at 2026-09-21/)
    await expect.element(getByTestId('value-coverage')).toHaveTextContent(/Period 30 day\(s\)/)
  })

  it('is a flattened section — no nested Card around the value KpiCards', async () => {
    const { container } = await renderWithClient(<ValueBasisBanner value={valueData()} />)
    const banner = container.querySelector('[data-testid="value-basis"]')
    expect(banner?.tagName).toBe('SECTION')
    expect(banner?.querySelector('.chart-card')).toBeNull()
  })

  it('announces closing_only with a compact alert, silent otherwise', async () => {
    const { container } = await renderWithClient(
      <ValueBasisBanner
        value={valueData({ basis: 'closing_only', basisNote: INVENTORY_CLOSING_ONLY_NOTE })}
      />,
    )
    expect(container.querySelector('[data-testid="closing-only-note"]')?.getAttribute('role')).toBe('alert')
    expect(container.textContent).toMatch(/closing-only basis/)
    const clean = await renderWithClient(<ValueBasisBanner value={valueData()} />)
    expect(clean.container.querySelector('[data-testid="closing-only-note"]')).toBeNull()
  })

  it('renders an unavailable opening as honesty, never ৳0', async () => {
    const { container } = await renderWithClient(
      <ValueBasisBanner
        value={valueData({
          basis: 'closing_only',
          basisNote: INVENTORY_CLOSING_ONLY_NOTE,
          value: {
            opening: { value: null, state: 'unavailable', reason: INVENTORY_CLOSING_ONLY_NOTE },
            closing: kpi({ value: 1000 }),
            average: { value: null, state: 'unavailable', reason: INVENTORY_CLOSING_ONLY_NOTE },
          },
        })}
      />,
    )
    expect(container.querySelector('[data-testid="value-basis"]')).not.toBeNull()
    // Unavailable opening/average render words — the only ৳ figure is the real close.
    expect(container.textContent).toMatch(/৳1,000/)
    expect(container.textContent).not.toMatch(/৳0/)
  })
})

// ─── turnover / DOI KpiValue states ──────────────────────────────────────────

describe('TurnoverCards', () => {
  it('renders turnover and DOI values', async () => {
    const { container, getByText } = await renderWithClient(<TurnoverCards value={valueData()} />)
    expect(container.querySelector('[data-testid="turnover-cards"]')).not.toBeNull()
    await expect.element(getByText('2.00×')).toBeInTheDocument()
    await expect.element(getByText('15.0 days')).toBeInTheDocument()
  })

  it('renders withheld turnover as unavailable via KpiCard', async () => {
    const { getByText } = await renderWithClient(
      <KpiCard
        title="Stock turnover (COGS ÷ avg)"
        kpi={{ value: null, state: 'unavailable', reason: 'history incomplete' }}
        format={(v) => `${v.toFixed(2)}×`}
      />,
    )
    await expect.element(getByText('history incomplete')).toBeInTheDocument()
  })
})

// ─── movement policy label + drill params ────────────────────────────────────

describe('MovementTable', () => {
  it('labels the default 30/90-day policy with a tap-friendly rationale disclosure', async () => {
    const { container, getByRole, getByTestId } = await renderWithClient(<MovementTable data={movementData()} />)
    const policy = container.querySelector('[data-testid="movement-policy"]')
    expect(policy).not.toBeNull()
    expect(policy?.textContent).toContain(MOVEMENT_POLICY_LABEL)
    expect(policy?.querySelector('[title]')).toBeNull()
    await userEvent.click(getByRole('button', { name: 'About movement policy' }))
    await expect.element(getByTestId('movement-policy-notes')).toHaveTextContent(/Default 30\/90-day policy rationale/)
  })

  it('drill links carry productId and variantId to the ledger view', async () => {
    const { container } = await renderWithClient(<MovementTable data={movementData()} />)
    const link = container.querySelector('[data-testid="movement-drill-p1"]')
    expect(link?.getAttribute('href')).toBe(
      '/mon/analytics/inventory?view=ledger&productId=p1&variantId=v1',
    )
  })

  it('renders DOI null as N/A, never 0 days or Infinity', async () => {
    const { getByText } = await renderWithClient(
      <MovementTable
        data={{
          ...movementData(),
          rows: [{ ...movementData().rows[0], doi: null }],
        }}
      />,
    )
    await expect.element(getByText('N/A', { exact: true })).toBeInTheDocument()
  })
})

// ─── lost-sales honesty ──────────────────────────────────────────────────────

describe('LostSalesCard', () => {
  it('states the honesty note and renders unavailable (never ৳0)', async () => {
    const { container } = await renderWithClient(<LostSalesCard data={stockoutsData()} />)
    expect(container.querySelector('[data-testid="lost-sales"]')).not.toBeNull()
    expect(container.textContent).toMatch(/only for days with stock/)
    expect(container.textContent).not.toMatch(/৳0/)
  })

  it('renders estimated lost sales with the evidence line', async () => {
    const { container } = await renderWithClient(
      <LostSalesCard
        data={stockoutsData({
          stockoutDays: kpi({ value: 5 }),
          productsAffected: 2,
          lostSales: {
            value: 100,
            state: 'estimated',
            reason: 'daily sales rate × 5 stock-out day(s)',
            lostUnits: 10,
          },
        })}
      />,
    )
    expect(container.querySelector('[data-testid="lost-units"]')).not.toBeNull()
    expect(container.textContent).toMatch(/2 product\(s\) affected/)
  })
})

// ─── aging ───────────────────────────────────────────────────────────────────

describe('AgingTable', () => {
  it('renders age buckets with units and value', async () => {
    const { container, getByText } = await renderWithClient(<AgingTable value={valueData()} />)
    expect(container.querySelector('[data-testid="aging-table"]')).not.toBeNull()
    await expect.element(getByText('0–30 days')).toBeInTheDocument()
  })
})

// ─── drill-down param propagation ────────────────────────────────────────────

describe('inventory drill-down', () => {
  it('propagates filters plus the §4.2 inventory view params', async () => {
    const { container } = await renderWithClient(
      <DrilldownPanel
        filters={{ preset: 'last_30_days', warehouseId: 'w1' }}
        queryBuilder={buildInventoryQuery}
        items={[
          { label: 'Movement class → product/variant', description: 'x', to: '/mon/analytics/products' },
          { label: 'Product/variant → stock ledger', description: 'x', to: '/mon/analytics/inventory', params: { view: 'ledger' } },
        ]}
      />,
    )
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((h) => h.includes('warehouseId=w1'))).toBe(true)
    expect(hrefs.some((h) => h.includes('view=ledger'))).toBe(true)
  })
})

// ─── drill landing: params → ledger filtered (effect, not href shape) ───────

describe('resolveInventoryDrill', () => {
  it('focuses the ledger on view=ledger', () => {
    expect(resolveInventoryDrill({ view: 'ledger' })).toEqual({
      focusLedger: true,
      productId: undefined,
      variantId: undefined,
    })
  })

  it('focuses the ledger on bare product params without an explicit view', () => {
    expect(resolveInventoryDrill({ productId: 'p1' }).focusLedger).toBe(true)
    expect(resolveInventoryDrill({ variantId: 'v1' }).focusLedger).toBe(true)
  })

  it('does not focus without drill params', () => {
    expect(resolveInventoryDrill(undefined).focusLedger).toBe(false)
    expect(resolveInventoryDrill({}).focusLedger).toBe(false)
    expect(resolveInventoryDrill({ view: 'movement' }).focusLedger).toBe(false)
  })

  it('movement drill hrefs round-trip through the landing resolver', () => {
    const href = inventoryLedgerHref('p1', 'v1')
    const search = Object.fromEntries(new URLSearchParams(href.split('?')[1]))
    expect(resolveInventoryDrill(search)).toEqual({ focusLedger: true, productId: 'p1', variantId: 'v1' })
    expect(inventoryLedgerHref('p9', null)).toBe('/mon/analytics/inventory?view=ledger&productId=p9')
  })
})

describe('resolveLedgerNames', () => {
  it('maps product|variant to the movement-row name', () => {
    expect(resolveLedgerNames([{ productId: 'p1', variantId: 'v1', name: 'Jar' }])).toEqual({
      'p1|v1': 'Jar',
    })
    expect(resolveLedgerNames([])).toEqual({})
  })
})

describe('InventoryLedgerSection focus note', () => {
  function ledgerData(): InventoryLedgerData {
    return {
      periodDays: 30,
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      dateBasis: 'Ledger entry date',
    }
  }

  it('names the drill product from the movement rows, not the raw id', async () => {
    const { container } = await renderWithClient(
      <InventoryLedgerSection
        data={ledgerData()}
        focus
        productId="p1"
        variantId="v1"
        names={{ 'p1|v1': 'Jar' }}
      />,
    )
    const note = container.querySelector('[data-testid="ledger-focus-note"]')?.textContent ?? ''
    expect(note).toContain('Jar')
    expect(note).not.toContain('product p1')
  })

  it('falls back to the raw id when the product has no movement row', async () => {
    const { container } = await renderWithClient(
      <InventoryLedgerSection data={ledgerData()} focus productId="p9" />,
    )
    expect(
      container.querySelector('[data-testid="ledger-focus-note"]')?.textContent,
    ).toContain('product p9')
  })
})

describe('inventory drill landing effect', () => {
  function ledgerData(): InventoryLedgerData {
    return {
      periodDays: 30,
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      dateBasis: 'Ledger entry date',
    }
  }

  function stubInventoryApi() {
    const meta = {
      formulaVersion: 'analytics-p2/1.0',
      dataAsOf: '2026-09-21T00:00:00.000Z',
      range: { periodDays: 30 },
      dateBasis: 'test',
    } as any
    vi.spyOn(businessAnalyticsApi, 'getInventoryValue').mockResolvedValue({
      data: { data: valueData(), meta },
    } as any)
    vi.spyOn(businessAnalyticsApi, 'getInventoryMovement').mockResolvedValue({
      data: { data: movementData(), meta },
    } as any)
    vi.spyOn(businessAnalyticsApi, 'getInventoryStockouts').mockResolvedValue({
      data: { data: stockoutsData(), meta },
    } as any)
    const ledger = vi.spyOn(businessAnalyticsApi, 'getInventoryLedger').mockResolvedValue({
      data: { data: ledgerData(), meta },
    } as any)
    return { ledger }
  }

  it('view=ledger filters the ledger request by product and marks the section', async () => {
    const { ledger } = stubInventoryApi()
    const { container } = await renderWithClient(
      <InventoryAnalytics initialSearch={{ view: 'ledger', productId: 'p1', variantId: 'v1' }} />,
    )
    await vi.waitFor(() => expect(ledger).toHaveBeenCalled())
    expect(ledger.mock.calls[0][0]).toMatchObject({ productId: 'p1', variantId: 'v1' })
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="ledger-section"]')).not.toBeNull(),
    )
    const section = container.querySelector('[data-testid="ledger-section"]')
    expect(section?.getAttribute('data-focus')).toBe('true')
    // Movement rows name p1/v1 "Jar" — the note shows the name, not the raw id.
    const note = container.querySelector('[data-testid="ledger-focus-note"]')?.textContent ?? ''
    expect(note).toContain('Jar')
    expect(note).toContain('v1')
    expect(note).not.toContain('product p1')
  })

  it('bare product params focus and filter the ledger without an explicit view', async () => {
    const { ledger } = stubInventoryApi()
    const { container } = await renderWithClient(<InventoryAnalytics initialSearch={{ productId: 'p1' }} />)
    await vi.waitFor(() => expect(ledger).toHaveBeenCalled())
    expect(ledger.mock.calls[0][0]).toMatchObject({ productId: 'p1' })
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="ledger-section"]')).not.toBeNull(),
    )
    expect(container.querySelector('[data-testid="ledger-section"]')?.getAttribute('data-focus')).toBe('true')
  })

  it('no drill params leave the ledger unfocused and unfiltered', async () => {
    const { ledger } = stubInventoryApi()
    const { container } = await renderWithClient(<InventoryAnalytics initialSearch={{}} />)
    await vi.waitFor(() => expect(ledger).toHaveBeenCalled())
    expect(ledger.mock.calls[0][0]).not.toHaveProperty('productId')
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="ledger-section"]')).not.toBeNull(),
    )
    expect(container.querySelector('[data-testid="ledger-section"]')?.getAttribute('data-focus')).toBe('false')
    expect(container.querySelector('[data-testid="ledger-focus-note"]')).toBeNull()
  })

  it('renders a single metadata footer (no WidgetShell duplication)', async () => {
    stubInventoryApi()
    const { container } = await renderWithClient(<InventoryAnalytics initialSearch={{}} />)
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="ledger-section"]')).not.toBeNull(),
    )
    expect(container.textContent?.match(/Formula /g) ?? []).toHaveLength(1)
  })
})

// ─── query keys: warehouse scope participates ────────────────────────────────

describe('inventory query keys', () => {
  it('warehouse scope changes every inventory request key', () => {
    const base: AnalyticsFilters = { preset: 'last_30_days' }
    const scoped: AnalyticsFilters = { preset: 'last_30_days', warehouseId: 'w1' }
    expect(inventoryValueQueryKey(scoped)).not.toEqual(inventoryValueQueryKey(base))
    expect(inventoryMovementQueryKey(scoped, 1, 20)).not.toEqual(inventoryMovementQueryKey(base, 1, 20))
    expect(inventoryStockoutsQueryKey(scoped, 1, 20)).not.toEqual(inventoryStockoutsQueryKey(base, 1, 20))
    expect(inventoryLedgerQueryKey(scoped, 1, 20)).not.toEqual(inventoryLedgerQueryKey(base, 1, 20))
  })

  it('buildInventoryQuery drops empty values and keeps the warehouse scope', () => {
    expect(buildInventoryQuery({ preset: 'last_30_days', warehouseId: '' })).toEqual({
      preset: 'last_30_days',
    })
    expect(
      buildInventoryQuery({ preset: 'last_30_days', warehouseId: 'w1' }),
    ).toEqual({ preset: 'last_30_days', warehouseId: 'w1' })
  })

  it('buildInventoryQuery carries the drill narrow and drops empties', () => {
    expect(
      buildInventoryQuery({ preset: 'last_30_days', productId: 'p1', variantId: 'v1' }),
    ).toEqual({ preset: 'last_30_days', productId: 'p1', variantId: 'v1' })
    expect(buildInventoryQuery({ preset: 'last_30_days', productId: '' })).toEqual({
      preset: 'last_30_days',
    })
  })

  it('ledger query key changes with the drill narrow', () => {
    const base: AnalyticsFilters = { preset: 'last_30_days' }
    expect(inventoryLedgerQueryKey({ ...base, productId: 'p1' }, 1, 20)).not.toEqual(
      inventoryLedgerQueryKey(base, 1, 20),
    )
  })

  it('filters constant carries the default preset', () => {
    expect(FILTERS.preset).toBe('last_30_days')
  })
})
