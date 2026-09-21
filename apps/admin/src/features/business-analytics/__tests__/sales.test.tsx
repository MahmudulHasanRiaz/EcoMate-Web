/**
 * P5 frontend tests (§7.2 sales items).
 *
 * Trio renders three bases distinctly · funnel "Not instrumented" (never
 * zeros) · settlement COD display + gap banner + inference column · drill
 * params · KpiValue states on sales metrics · trend legend bases.
 */
import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KpiCard } from '../components/KpiCard'
import { FunnelPanel } from '../components/FunnelPanel'
import { PipelinePanel } from '../components/PipelinePanel'
import { SettlementTable } from '../components/SettlementTable'
import { SalesTrendChart } from '../components/SalesTrendChart'
import { DrilldownPanel, type DrilldownItem } from '../components/DrilldownPanel'
import { SettlementGapBanner } from '../components/FulfillmentEconomicsPanel'
import { salesSettlementQueryKey, salesSummaryQueryKey } from '../api'
import type {
  AnalyticsFilters,
  KpiValue,
  SalesFunnelStage,
  SalesSettlementRow,
  SalesTrendPoint,
} from '../types'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function kpi(over: Partial<KpiValue>): KpiValue {
  return { value: 1000, state: 'ok', ...over }
}

// ─── Trio: three bases, distinctly ───────────────────────────────────────────

describe('lens trio', () => {
  it('renders Booked / Recognised / Cash with distinct date bases', async () => {
    const booked = kpi({ value: 50000, dateBasis: 'Order.createdAt — intake only, never in the ladder' })
    const recognised = kpi({ value: 42000, dateBasis: 'Delivered transition — the P&L basis' })
    const cash = kpi({ value: 38000, dateBasis: 'Payment.createdAt (PAID only)' })
    const b = await renderWithClient(<KpiCard title="Booked (L1)" kpi={booked} />)
    await expect.element(b.getByText('৳50,000', { exact: true })).toBeInTheDocument()
    await expect.element(b.getByText(/intake only/)).toBeInTheDocument()
    const r = await renderWithClient(<KpiCard title="Recognised (L2)" kpi={recognised} />)
    await expect.element(r.getByText('৳42,000', { exact: true })).toBeInTheDocument()
    await expect.element(r.getByText(/the P&L basis/)).toBeInTheDocument()
    const c = await renderWithClient(<KpiCard title="Cash Collected (L3)" kpi={cash} />)
    await expect.element(c.getByText('৳38,000', { exact: true })).toBeInTheDocument()
    await expect.element(c.getByText(/PAID only/)).toBeInTheDocument()
  })

  it('renders AOV with no_data (never ৳0) when nothing recognised', async () => {
    const { getByText } = await renderWithClient(
      <KpiCard title="AOV (Recognised)" kpi={{ value: null, state: 'no_data', reason: 'no recognised orders in range' }} />,
    )
    await expect.element(getByText('No data', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳0', { exact: true })).not.toBeInTheDocument()
  })
})

// ─── Funnel: unsupported "Not instrumented" ──────────────────────────────────

const FUNNEL: SalesFunnelStage[] = [
  { key: 'add_to_cart', label: 'Add to Cart', instrumented: false, orders: null, value: null, shareOfBooked: null, conversionFromPrev: null, reason: 'Not instrumented — cart events are not persisted internally (§8.7)' },
  { key: 'checkout_started', label: 'Checkout Started', instrumented: false, orders: null, value: null, shareOfBooked: null, conversionFromPrev: null, reason: 'Not instrumented — checkout-start events are not persisted internally (§8.7)' },
  { key: 'booked', label: 'Booked', instrumented: true, orders: 40, value: 80000, shareOfBooked: 1, conversionFromPrev: null, dateBasis: 'Order.createdAt — intake only' },
  { key: 'delivered', label: 'Delivered', instrumented: true, orders: 30, value: 60000, shareOfBooked: 0.75, conversionFromPrev: 0.75, dateBasis: 'intake cohort' },
]

describe('FunnelPanel', () => {
  it('renders unsupported stages as "Not instrumented", never zeros', async () => {
    const { container, getByText } = await renderWithClient(<FunnelPanel stages={FUNNEL} />)
    const cart = container.querySelector('[data-testid="funnel-stage-add_to_cart"]')?.textContent ?? ''
    expect(cart).toMatch(/Not instrumented/)
    expect(cart).not.toMatch(/\b0\b.*৳/)
    await expect.element(getByText('Not instrumented', { exact: false }).first()).toBeInTheDocument()
  })

  it('renders supported counts with conversion', async () => {
    const { getByText } = await renderWithClient(<FunnelPanel stages={FUNNEL} />)
    await expect.element(getByText(/40 · ৳80,000/)).toBeInTheDocument()
    await expect.element(getByText(/75\.0% conv\./)).toBeInTheDocument()
  })
})

// ─── Trend: three bases on one axis ──────────────────────────────────────────

function point(label: string, amount: number, orders: number): SalesTrendPoint {
  return { bucketStart: `2026-09-0${orders}T00:00:00.000Z`, label, amount, orders }
}

describe('SalesTrendChart', () => {
  it('legends all three bases with their date basis', async () => {
    const { getByText } = await renderWithClient(
      <SalesTrendChart
        booked={[point('Sep 1', 10000, 1), point('Sep 2', 12000, 2)]}
        recognised={[point('Sep 1', 8000, 1), point('Sep 2', 9000, 2)]}
        cash={[point('Sep 1', 7000, 1), point('Sep 2', 7500, 2)]}
        granularity="day"
        requestedGranularity="day"
      />,
    )
    await expect.element(getByText('Booked (Order.createdAt)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Recognised (Delivered)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Cash (Payment.createdAt)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/never mixed/)).toBeInTheDocument()
  })
})

// ─── Settlement: COD display + banner + inference ────────────────────────────

function settlementRow(over: Partial<SalesSettlementRow>): SalesSettlementRow {
  return {
    orderId: 'o1',
    displayId: 'ORD-260901-0001',
    status: 'Delivered',
    createdAt: '2026-09-02T10:00:00.000Z',
    collection: 'online',
    amountCollected: { value: 1060, state: 'actual' },
    amountRefunded: { value: 0, state: 'actual' },
    amountRetained: { value: 1060, state: 'actual' },
    deliveryChargeRetained: { value: 60, state: 'actual', inference: 'none' },
    courierCost: { value: 50, state: 'actual' },
    fulfillmentMargin: { value: 10, state: 'actual' },
    disclosure: null,
    ...over,
  }
}

const COD_ROW = settlementRow({
  orderId: 'cod1',
  displayId: 'ORD-260901-0002',
  status: 'Shipping',
  collection: 'cod',
  amountCollected: { value: null, state: 'unavailable', reason: 'no_courier_settlement_source' },
  amountRetained: { value: null, state: 'unavailable', reason: 'no_courier_settlement_source' },
  deliveryChargeRetained: { value: null, state: 'unavailable', reason: 'no_courier_settlement_source', inference: 'none' },
  fulfillmentMargin: { value: null, state: 'unavailable', reason: 'no_courier_settlement_source' },
  disclosure: 'no_courier_settlement_source',
})

const GAP = {
  codOrders: 1,
  courierCost: 50,
  message: 'COD settlement data is not captured. Collection, retained amount and fulfillment margin are unavailable for these 1 orders (৳50 courier cost). A courier settlement import will supply this.',
}

describe('SettlementTable', () => {
  it('renders COD rows as Unavailable with the canonical reason + gap banner', async () => {
    const { container, getByText, getByRole } = await renderWithClient(
      <SettlementTable
        rows={[settlementRow({}), COD_ROW]}
        total={2}
        page={1}
        pageSize={20}
        totalPages={1}
        gapBanner={GAP}
        panelNote="Not part of recognised revenue."
        onPageChange={() => {}}
      />,
    )
    await expect.element(getByRole('alert')).toHaveTextContent(/COD settlement data is not captured/)
    const codRow = container.querySelector('[data-testid="settlement-row-cod1"]')?.textContent ?? ''
    expect(codRow).toMatch(/Unavailable/)
    expect(codRow).toMatch(/no_courier_settlement_source/)
    expect(codRow).not.toMatch(/৳1,060/)
    await expect.element(getByText('ORD-260901-0002', { exact: true })).toBeInTheDocument()
  })

  it('labels the inference column and links the ladder once', async () => {
    const inferred = settlementRow({
      orderId: 'o2',
      deliveryChargeRetained: { value: 0, state: 'actual', inference: 'covered', reason: 'shipping-refund inference (covered) — labelled, not measured' },
      fulfillmentMargin: { value: -50, state: 'actual' },
      disclosure: 'shipping-refund inference (covered) — labelled, not measured',
    })
    const { container, getByText } = await renderWithClient(
      <SettlementTable
        rows={[inferred]}
        total={1}
        page={1}
        pageSize={20}
        totalPages={1}
        gapBanner={{ codOrders: 0, courierCost: 0, message: '' }}
        panelNote="Not part of recognised revenue."
        onPageChange={() => {}}
      />,
    )
    await expect.element(getByText('inference: covered', { exact: true })).toBeInTheDocument()
    const note = container.textContent ?? ''
    expect(note).toMatch(/same underlying cost, shown once in the ladder/)
    expect(note).toMatch(/Not part of recognised revenue/)
  })

  it('renders no banner when every row is online', async () => {
    const { container } = await renderWithClient(
      <SettlementGapBanner gapBanner={{ codOrders: 0, courierCost: 0, message: '' }} />,
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('paginates with counts', async () => {
    const { getByText } = await renderWithClient(
      <SettlementTable
        rows={[settlementRow({})]}
        total={41}
        page={2}
        pageSize={20}
        totalPages={3}
        gapBanner={{ codOrders: 0, courierCost: 0, message: '' }}
        panelNote=""
        onPageChange={() => {}}
      />,
    )
    await expect.element(getByText('Showing 21–40 of 41 order(s)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Page 2 of 3', { exact: true })).toBeInTheDocument()
  })
})

// ─── Pipeline: never-revenue labelling ───────────────────────────────────────

describe('PipelinePanel', () => {
  it('labels every row pipeline — never revenue', async () => {
    const { container, getByText } = await renderWithClient(
      <PipelinePanel
        stages={[
          { key: 'intake', label: 'Intake', orders: 5, value: 10000, note: 'pipeline — not revenue (recognised only at Delivered)' },
          { key: 'shipping', label: 'Shipping', orders: 2, value: 4000, note: 'pipeline — not revenue (recognised only at Delivered)' },
        ]}
        totalOrders={7}
        totalValue={14000}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toMatch(/pipeline, never revenue/)
    expect(text).toMatch(/৳14,000/)
    expect(text).toMatch(/Intake/)
    expect(text).toMatch(/pipeline — not revenue \(recognised only at Delivered\)/)
  })
})

// ─── Drill-down param propagation ────────────────────────────────────────────

const SALES_ITEMS: DrilldownItem[] = [
  { label: 'Gross Sales → Net Sales → breakdown → orders', description: 'rows', to: '/op/orders', params: { deliveryOutcome: 'delivered' } },
  { label: 'Settlement gap → COD orders', description: 'rows', to: '/op/dispatch', params: { collectionStatus: 'cod-unavailable' } },
]

describe('sales DrilldownPanel', () => {
  it('propagates every active filter plus the drill dimension', async () => {
    const filters: AnalyticsFilters = {
      preset: 'custom',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
      source: 'ECOMMERCE',
    }
    const { container } = await renderWithClient(<DrilldownPanel filters={filters} items={SALES_ITEMS} />)
    const links = [...container.querySelectorAll('a')]
    expect(links.length).toBe(2)
    for (const a of links) {
      const href = a.getAttribute('href') ?? ''
      expect(href).toContain('preset=custom')
      expect(href).toContain('source=ECOMMERCE')
    }
    expect(links[0].getAttribute('href')).toContain('/op/orders')
    expect(links[0].getAttribute('href')).toContain('deliveryOutcome=delivered')
    expect(links[1].getAttribute('href')).toContain('collectionStatus=cod-unavailable')
  })
})

// ─── Query keys ──────────────────────────────────────────────────────────────

describe('sales query keys', () => {
  it('summary key changes with every filter; settlement key adds page/pageSize', () => {
    const base: AnalyticsFilters = { preset: 'last_30_days' }
    expect(JSON.stringify(salesSummaryQueryKey({ ...base, source: 'POS' }))).not.toBe(
      JSON.stringify(salesSummaryQueryKey(base)),
    )
    expect(JSON.stringify(salesSettlementQueryKey(base, 1, 20))).not.toBe(
      JSON.stringify(salesSettlementQueryKey(base, 2, 20)),
    )
    expect(JSON.stringify(salesSettlementQueryKey(base, 1, 20))).not.toBe(
      JSON.stringify(salesSettlementQueryKey(base, 1, 50)),
    )
  })
})
