/**
 * P3 frontend tests (§7.2 overview items).
 *
 * filter → query-key → request-params · every KpiValue state renders ·
 * bridge never renders Fulfillment Margin as an operand · settlement compact
 * COD-unavailable + gap banner · drill-down param propagation · delta
 * sign/format · RecognitionStrip counts · waterfall ladderState banner.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KpiCard } from '../components/KpiCard'
import { ContributionBridge } from '../components/ContributionBridge'
import { FulfillmentEconomicsPanel, SettlementGapBanner } from '../components/FulfillmentEconomicsPanel'
import { DrilldownPanel } from '../components/DrilldownPanel'
import { ComparisonDelta } from '../components/ComparisonDelta'
import { RecognitionStrip } from '../components/RecognitionStrip'
import { PnlWaterfall } from '../components/PnlWaterfall'
import { AnalyticsFilterBar } from '../components/AnalyticsFilterBar'
import { buildOverviewQuery, overviewQueryKey } from '../api'
import type { AnalyticsFilters, BridgeData, FulfillmentCompact, KpiValue, OverviewData } from '../types'

vi.mock('@/features/categories/api', () => ({
  categoriesApi: { list: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}))

function kpi(over: Partial<KpiValue>): KpiValue {
  return { value: 12500, state: 'ok', ...over }
}

const bridge: BridgeData = {
  contributionProfit: 40000,
  deliveryChargeRetained: 6000,
  deliveryChargeRetainedState: 'actual',
  fulfillmentMargin: 1000,
  totalBusinessContribution: 46000,
  operatingProfit: 30000,
  netProfit: 30000,
  operands: ['contributionProfit', 'deliveryChargeRetained'],
  codRecognisedOrders: 0,
  excludedCodShippingCharge: 0,
  shippingRefundInferences: 0,
  state: 'ok',
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// ─── filter → query-key → request-params ─────────────────────────────────────

describe('filter → query-key → request-params', () => {
  const ALL_DIMS: [keyof AnalyticsFilters, string][] = [
    ['source', 'POS'],
    ['salesChannel', 'WEBSITE'],
    ['marketingSource', 'facebook'],
    ['paymentMethod', 'BKASH'],
    ['categoryId', 'c1'],
    ['location', 'Dhaka'],
    ['customerSegment', 'new'],
    ['deliveryOutcome', 'delivered'],
    ['collectionStatus', 'cod-unavailable'],
    ['granularity', 'week'],
  ]

  it('drops empty values, keeps the rest', () => {
    expect(buildOverviewQuery({ preset: 'last_30_days' })).toEqual({ preset: 'last_30_days' })
    expect(buildOverviewQuery({ preset: 'custom', startDate: '2026-09-01', endDate: '2026-09-07', source: '' })).toEqual({
      preset: 'custom',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
    })
  })

  it.each(ALL_DIMS)('every filter (%s) changes the query key and request params', (key, val) => {
    const base: AnalyticsFilters = { preset: 'last_30_days' }
    const next = { ...base, [key]: val }
    expect(JSON.stringify(overviewQueryKey(next))).not.toBe(JSON.stringify(overviewQueryKey(base)))
    expect(buildOverviewQuery(next)[key]).toBe(val)
  })

  it('never emits a Store dimension', () => {
    const q = buildOverviewQuery({ preset: 'last_30_days', source: 'POS' })
    expect('store' in q).toBe(false)
    expect('storeId' in q).toBe(false)
  })
})

// ─── KpiValue states ─────────────────────────────────────────────────────────

describe('KpiCard states', () => {
  it('renders ok as ৳, never bare', async () => {
    const { getByText } = await renderWithClient(<KpiCard title="Net Sales" kpi={kpi({})} />)
    await expect.element(getByText('৳12,500', { exact: true })).toBeInTheDocument()
  })

  it('renders estimated with badge + separated reference excluded from total', async () => {
    const { getByText } = await renderWithClient(
      <KpiCard
        title="Net Profit"
        kpi={kpi({ state: 'estimated', reason: 'estimated — see coverage', estimatedReference: { label: 'undated spend', excludedFromTotal: true } })}
      />,
    )
    await expect.element(getByText('Estimated', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/excluded from total/)).toBeInTheDocument()
    await expect.element(getByText(/Reference: undated spend/)).toBeInTheDocument()
  })

  it('renders unavailable as words — never ৳0', async () => {
    const { getByText } = await renderWithClient(
      <KpiCard title="Marketing" kpi={{ value: 5000, state: 'unavailable', reason: '2 consumption(s) missing spendDate' }} />,
    )
    await expect.element(getByText('Unavailable', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳0', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('৳5,000', { exact: true })).not.toBeInTheDocument()
  })

  it('renders not_applicable as "—", distinct from unavailable', async () => {
    const { getByText } = await renderWithClient(
      <KpiCard title="Other Costs" kpi={{ value: null, state: 'not_applicable', reason: 'no data source exists' }} />,
    )
    await expect.element(getByText('—', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Unavailable', { exact: true })).not.toBeInTheDocument()
  })

  it('renders no_data and zero distinctly', async () => {
    const none = await renderWithClient(<KpiCard title="A" kpi={{ value: null, state: 'no_data', reason: 'empty' }} />)
    await expect.element(none.getByText('No data', { exact: true })).toBeInTheDocument()
    const zero = await renderWithClient(<KpiCard title="B" kpi={{ value: 0, state: 'zero', reason: 'measured zero' }} />)
    await expect.element(zero.getByText('৳0', { exact: true })).toBeInTheDocument()
  })
})

// ─── Bridge: FM never an operand ─────────────────────────────────────────────

describe('ContributionBridge', () => {
  it('renders exactly Contribution Profit + Delivery Charge Retained as operands', async () => {
    const { container, getByText } = await renderWithClient(<ContributionBridge bridge={bridge} />)
    await expect.element(getByText('৳40,000', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳6,000', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳46,000', { exact: true })).toBeInTheDocument()
    const operands = container.querySelector('[data-testid="bridge-operands"]')?.textContent ?? ''
    expect(operands).toContain('Contribution Profit')
    expect(operands).toContain('Delivery Charge Retained')
    expect(operands).not.toMatch(/Fulfillment Margin/)
  })

  it('keeps Fulfillment Margin as a diagnostic caption only', async () => {
    const { container } = await renderWithClient(<ContributionBridge bridge={bridge} />)
    const diag = container.querySelector('[data-testid="bridge-fm-diagnostic"]')?.textContent ?? ''
    expect(diag).toMatch(/not an additive component/)
  })
})

// ─── Settlement compact: COD-unavailable + gap banner ────────────────────────

const codFulfillment: FulfillmentCompact = {
  totals: { collected: 9000, refunded: 500, retained: 8500, courierCost: 1200, deliveryChargeRetained: 800, fulfillmentMargin: -400 },
  coverage: { onlineOrders: 9, codOrders: 4, collectionUnavailableOrders: 4, unknownAmount: 1100 },
  gapBanner: {
    codOrders: 4,
    courierCost: 1100,
    message: 'COD settlement data is not captured. Collection, retained amount and fulfillment margin are unavailable for these 4 orders (৳1,100 courier cost). A courier settlement import will supply this.',
  },
  panelNote: 'Not part of recognised revenue.',
}

describe('FulfillmentEconomicsPanel (compact)', () => {
  it('renders the verbatim gap banner when COD orders exist', async () => {
    const { getByRole } = await renderWithClient(<FulfillmentEconomicsPanel fulfillment={codFulfillment} />)
    await expect.element(getByRole('alert')).toHaveTextContent(/COD settlement data is not captured/)
  })

  it('marks collection figures unavailable for COD with online-only labelling', async () => {
    const { container, getByText } = await renderWithClient(<FulfillmentEconomicsPanel fulfillment={codFulfillment} />)
    const note = container.querySelector('[data-testid="cod-unavailable-note"]')?.textContent ?? ''
    expect(note).toMatch(/unavailable for 4 COD order/)
    await expect.element(getByText('online orders only', { exact: false }).first()).toBeInTheDocument()
  })

  it('renders no banner when every order is online', async () => {
    const online: FulfillmentCompact = {
      ...codFulfillment,
      coverage: { onlineOrders: 13, codOrders: 0, collectionUnavailableOrders: 0, unknownAmount: 0 },
      gapBanner: { codOrders: 0, courierCost: 0, message: '' },
    }
    const { container, getByText } = await renderWithClient(<SettlementGapBanner gapBanner={online.gapBanner} />)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await expect.element(getByText(/Total Collected/)).not.toBeInTheDocument()
  })
})

// ─── Drill-down param propagation ────────────────────────────────────────────

describe('DrilldownPanel', () => {
  it('propagates every active filter into every drill link', async () => {
    const filters: AnalyticsFilters = {
      preset: 'custom',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
      source: 'POS',
      collectionStatus: 'cod-unavailable',
    }
    const { container } = await renderWithClient(<DrilldownPanel filters={filters} />)
    const links = [...container.querySelectorAll('a')]
    expect(links.length).toBeGreaterThan(0)
    for (const a of links) {
      const href = a.getAttribute('href') ?? ''
      expect(href).toContain('preset=custom')
      expect(href).toContain('startDate=2026-09-01')
      expect(href).toContain('source=POS')
      expect(href).toContain('collectionStatus=cod-unavailable')
    }
    const dispatch = container.querySelector('a[href*="/op/dispatch"]')?.getAttribute('href') ?? ''
    expect(dispatch).toContain('/op/dispatch')
  })
})

// ─── Delta sign/format ───────────────────────────────────────────────────────

describe('ComparisonDelta', () => {
  it('prefixes gains with + and losses with −', async () => {
    const up = await renderWithClient(<ComparisonDelta label="Net Sales" current={12000} previous={10000} />)
    await expect.element(up.getByText('+৳2,000', { exact: true })).toBeInTheDocument()
    await expect.element(up.getByText('(+20.0% vs prev)', { exact: true })).toBeInTheDocument()
    const down = await renderWithClient(<ComparisonDelta label="Net Sales" current={8000} previous={10000} />)
    await expect.element(down.getByText('-৳2,000', { exact: true })).toBeInTheDocument()
  })

  it('renders "—" for pct on a null denominator, never Infinity', async () => {
    const { getByText } = await renderWithClient(<ComparisonDelta label="Net Sales" current={5000} previous={0} />)
    await expect.element(getByText('(— vs prev)', { exact: true })).toBeInTheDocument()
  })

  it('keeps the sign truthful for negative-friendly metrics (loss deepening)', async () => {
    const { getByText } = await renderWithClient(<ComparisonDelta label="Net Profit" current={-8000} previous={-5000} />)
    await expect.element(getByText('-৳3,000', { exact: true })).toBeInTheDocument()
  })
})

// ─── RecognitionStrip counts ─────────────────────────────────────────────────

describe('RecognitionStrip', () => {
  it('renders booked / in-fulfilment / recognised / rate / date-source mix', async () => {
    const { getByText } = await renderWithClient(
      <RecognitionStrip
        strip={{
          bookedOrders: 120,
          bookedAmount: 250000,
          recognised: 90,
          inFulfilment: 20,
          delivered: 95,
          notYetRecognised: 25,
          recognitionRate: 0.75,
          dateSourceMix: { timeline: 85, dispatch: 5 },
          undatedDeliveries: 2,
        }}
      />,
    )
    await expect.element(getByText('120 · ৳250,000', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('20', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('90', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('75.0%', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/timeline: 85 · dispatch: 5 · undated deliveries: 2/)).toBeInTheDocument()
  })
})

// ─── Waterfall ladderState banner + Operating==Net wording ───────────────────

function waterfallPnl(netState: KpiValue['state']): OverviewData['pnl'] {
  const line = (value: number | null, state: KpiValue['state'] = 'ok'): KpiValue => ({ value, state })
  return {
    lines: {
      grossSales: line(100000),
      discounts: line(5000),
      returns: line(2000),
      refundsReversal: line(0, 'zero'),
      netSales: line(93000),
      cogs: line(40000),
      grossProfit: line(53000),
      fulfillmentCost: line(6000),
      paymentFees: { value: 900, state: 'unavailable', reason: 'feeAmount coverage' },
      marketingCost: line(5000),
      contributionProfit: { value: 36100, state: 'unavailable', reason: 'ladder inputs incomplete' },
      operatingExpenses: line(8000),
      operatingProfit: { value: 28100, state: 'unavailable', reason: 'ladder inputs incomplete' },
      otherCosts: { value: null, state: 'not_applicable', reason: 'no data source exists' },
      netProfit: { value: 28100, state: netState, reason: netState === 'ok' ? undefined : 'ladder inputs incomplete — see coverage' },
    },
    margins: { gross: 0.5, contribution: 0.4, operating: 0.3, net: 0.3 },
    bridge,
    lenses: {
      booked: line(120000),
      recognised: line(93000),
      cashCollected: line(88000),
    },
    strip: {
      bookedOrders: 120, bookedAmount: 120000, recognised: 90, inFulfilment: 20,
      delivered: 95, notYetRecognised: 25, recognitionRate: 0.75,
      dateSourceMix: { timeline: 85, dispatch: 5 }, undatedDeliveries: 2,
    },
    coverage: {
      cogs: { actualPct: 100, estimatedPct: 0, unavailableUnits: 0, unavailableItems: 0 },
      shipping: { actualOrders: 90, estimatedOrders: 0, unavailableOrders: 0 },
      fees: { paidPayments: 90, withFee: 80, withoutFee: 10 },
      marketing: { datedRows: 5, undatedRows: 0, datedAmount: 5000, undatedAmount: 0 },
      delivery: { onlineOrders: 90, codOrders: 0, collectionUnavailableOrders: 0 },
    },
    marketing: { datedRows: 5, undatedRows: 0, datedAmount: 5000, undatedAmount: 0, estimatedReference: null },
  }
}

describe('PnlWaterfall', () => {
  it('states the partial banner with the missing-input count unless actual', async () => {
    const { getByText } = await renderWithClient(<PnlWaterfall pnl={waterfallPnl('unavailable')} />)
    await expect.element(getByText(/Net Profit \(partial — \d+ inputs missing\)/)).toBeInTheDocument()
    await expect.element(getByText(/Operating Profit equals Net Profit/)).toBeInTheDocument()
  })

  it('shows no banner when the ladder is fully actual', async () => {
    const { container } = await renderWithClient(<PnlWaterfall pnl={waterfallPnl('ok')} />)
    await new Promise((r) => setTimeout(r, 200))
    expect(container.textContent ?? '').not.toMatch(/Net Profit \((partial|estimated)/)
  })
})

// ─── Filter bar: dimension changes propagate to onChange ─────────────────────

describe('AnalyticsFilterBar', () => {
  it('emits dimension changes through onChange', async () => {
    let seen: AnalyticsFilters = { preset: 'last_30_days' }
    const { getByText, getByPlaceholder } = await renderWithClient(
      <AnalyticsFilterBar value={{ preset: 'last_30_days' }} onChange={(n) => { seen = n }} />,
    )
    await expect.element(getByText('Today', { exact: true })).toBeInTheDocument()
    await userEvent.fill(getByPlaceholder('slug / utm_source'), 'facebook')
    expect(seen.marketingSource).toBe('facebook')
    expect(seen.preset).toBe('last_30_days')
  })
})
