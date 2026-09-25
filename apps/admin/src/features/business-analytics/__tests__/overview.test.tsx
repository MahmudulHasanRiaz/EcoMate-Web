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
import { ComponentOnceLedger } from '../components/ComponentOnceLedger'
import { HintTooltip, InfoDisclosure, MetricMetaFooter } from '../components/analytics-ui'
import { DataCoverageBadge } from '../components/badges'
import { FulfillmentEconomicsPanel, SettlementGapBanner } from '../components/FulfillmentEconomicsPanel'
import { DrilldownPanel } from '../components/DrilldownPanel'
import { ComparisonDelta } from '../components/ComparisonDelta'
import { RecognitionStrip } from '../components/RecognitionStrip'
import { PnlWaterfall } from '../components/PnlWaterfall'
import { AnalyticsFilterBar } from '../components/AnalyticsFilterBar'
import { buildOverviewQuery, overviewQueryKey } from '../api'
import BusinessOverview from '../index'
import type { AnalyticsFilters, BridgeData, FulfillmentCompact, KpiValue, OverviewData } from '../types'

vi.mock('@/features/categories/api', () => ({
  categoriesApi: { list: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}))

vi.mock('../hooks', () => ({
  useBusinessOverview: () => ({ data: null, isLoading: true, error: undefined, refetch: () => {} }),
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

  it('renders estimated with badge; reference + reason live in the info disclosure', async () => {
    const { getByText, getByRole, getByTestId } = await renderWithClient(
      <KpiCard
        title="Net Profit"
        kpi={kpi({ state: 'estimated', reason: 'estimated — see coverage', estimatedReference: { label: 'undated spend', excludedFromTotal: true } })}
      />,
    )
    await expect.element(getByText('Estimated', { exact: true })).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: 'About Net Profit' }))
    await expect.element(getByTestId('kpi-meta-detail')).toHaveTextContent(/Reference: undated spend/)
    await expect.element(getByTestId('kpi-meta-detail')).toHaveTextContent(/excluded from total/)
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

  it('renders the settled value with the CountUp animation opted out', async () => {
    const { getByText } = await renderWithClient(<KpiCard title="Net Sales" kpi={kpi({})} animate={false} />)
    await expect.element(getByText('৳12,500', { exact: true })).toBeInTheDocument()
  })
})

// ─── KpiCard info disclosure ─────────────────────────────────────────────────

describe('KpiCard info disclosure', () => {
  it('kills the visible dateBasis caption; meta lives in the info interaction', async () => {
    const { container, getByRole, getByTestId } = await renderWithClient(
      <KpiCard
        title="Net Sales"
        kpi={kpi({ reason: 'measured', dateBasis: 'Delivered-transition-basis-xyz' })}
        formulaVersion="v9"
      />,
    )
    // No visible caption duplicates the tooltip.
    const dups = [...container.querySelectorAll('p')].filter((p) =>
      p.textContent?.includes('Delivered-transition-basis-xyz'),
    )
    expect(dups).toHaveLength(0)
    // sr-only audit trail keeps the meta for assistive tech.
    expect(container.querySelector('[data-testid="kpi-meta-sr"]')?.textContent).toContain(
      'Delivered-transition-basis-xyz',
    )
    // Reason + dateBasis + formula open on tap (popover path — 3 lines).
    await userEvent.click(getByRole('button', { name: 'About Net Sales' }))
    await expect.element(getByTestId('kpi-meta-detail')).toHaveTextContent(/Date basis: Delivered-transition-basis-xyz/)
    await expect.element(getByTestId('kpi-meta-detail')).toHaveTextContent(/Formula: v9/)
  })

  it('renders no info control when there is nothing to disclose', async () => {
    const { container } = await renderWithClient(<KpiCard title="Net Sales" kpi={kpi({ reason: undefined })} />)
    expect(container.querySelector('button[aria-label^="About"]')).toBeNull()
    expect(container.querySelector('[data-testid="kpi-meta-sr"]')).toBeNull()
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

  it('keeps Fulfillment Margin as a diagnostic behind the info control only', async () => {
    const { getByText, getByRole, getByTestId } = await renderWithClient(
      <ContributionBridge bridge={bridge} />,
    )
    await expect.element(getByText(/Fulfillment Margin ৳1,000/)).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: 'About Fulfillment Margin' }))
    await expect.element(getByTestId('bridge-fm-diagnostic')).toHaveTextContent(/not an additive component/)
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

  it('cuts self-links on the overview page but keeps cross-page ones', async () => {
    const { container } = await renderWithClient(
      <DrilldownPanel filters={{ preset: 'last_30_days' }} currentPath="/mon/analytics" />,
    )
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.length).toBeGreaterThan(0)
    // Exact-match self-cut: same-path rows with different dimension params
    // (ladder/bridge/fulfillment/coverage) are different drill steps — keep.
    expect(hrefs.some((h) => h.includes('view=ladder'))).toBe(true)
    expect(hrefs.some((h) => h.includes('view=bridge'))).toBe(true)
    expect(hrefs.some((h) => h.includes('view=fulfillment'))).toBe(true)
    expect(hrefs.some((h) => h.includes('view=coverage'))).toBe(true)
    expect(hrefs.some((h) => h.includes('/op/dispatch'))).toBe(true)
    expect(hrefs.some((h) => h.includes('/mon/analytics/products'))).toBe(true)
  })

  it('cuts only the exact (path + params) duplicate', async () => {
    const { container } = await renderWithClient(
      <DrilldownPanel
        filters={{ preset: 'last_30_days' }}
        currentPath="/mon/analytics"
        currentParams={{ view: 'ladder' }}
      />,
    )
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((h) => h.includes('view=ladder'))).toBe(false)
    expect(hrefs.some((h) => h.includes('view=bridge'))).toBe(true)
    expect(hrefs.some((h) => h.includes('view=fulfillment'))).toBe(true)
    expect(hrefs.some((h) => h.includes('view=coverage'))).toBe(true)
    expect(hrefs.some((h) => h.includes('/op/dispatch'))).toBe(true)
  })

  it('cuts a paramless exact duplicate but keeps parameterized same-path rows', async () => {
    const items = [
      { label: 'Self', description: 'same page', to: '/mon/analytics/products' },
      { label: 'Other', description: 'drill', to: '/op/orders', params: { deliveryOutcome: 'in_fulfilment' } },
    ]
    const { container } = await renderWithClient(
      <DrilldownPanel filters={{ preset: 'last_30_days' }} items={items} currentPath="/mon/analytics/products" />,
    )
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((h) => h.split('?')[0] === '/mon/analytics/products')).toBe(false)
    expect(hrefs.some((h) => h.includes('/op/orders'))).toBe(true)
  })

  it('cuts only the byte-equal row for a full currentHref', async () => {
    const filters: AnalyticsFilters = { preset: 'last_30_days' }
    const probe = await renderWithClient(<DrilldownPanel filters={filters} />)
    const bridgeHref =
      [...probe.container.querySelectorAll('a')]
        .map((a) => a.getAttribute('href') ?? '')
        .find((h) => h.includes('view=bridge')) ?? ''
    expect(bridgeHref).not.toBe('')
    const { container } = await renderWithClient(<DrilldownPanel filters={filters} currentHref={bridgeHref} />)
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs).not.toContain(bridgeHref)
    expect(hrefs.some((h) => h.includes('view=ladder'))).toBe(true)
    expect(hrefs.some((h) => h.includes('view=coverage'))).toBe(true)
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

  it('renders a visible per-delta label (never an anonymous chip)', async () => {
    const { getByText } = await renderWithClient(<ComparisonDelta label="Cash collected" current={88000} previous={80000} />)
    await expect.element(getByText('Cash collected', { exact: true })).toBeInTheDocument()
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

  it('discloses the date-source mix through the info control', async () => {
    const { getByRole, getByTestId } = await renderWithClient(
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
    await userEvent.click(getByRole('button', { name: 'About date sources' }))
    await expect.element(getByTestId('strip-date-sources')).toHaveTextContent(/timeline: 85/)
    await expect.element(getByTestId('strip-date-sources')).toHaveTextContent(/undated deliveries: 2/)
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

  it('keeps every result row visible as an open collapsible summary', async () => {
    const { container, getByText } = await renderWithClient(<PnlWaterfall pnl={waterfallPnl('unavailable')} />)
    for (const label of ['= Net Sales', '= Gross Profit', '= Contribution Profit', '= Operating Profit', '= Net Profit']) {
      const group = container.querySelector(`[data-testid="pnl-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"]`)
      expect(group?.hasAttribute('open')).toBe(true)
      expect(group?.querySelector('summary')?.textContent).toContain(label)
    }
    await expect.element(getByText('− COGS', { exact: true })).toBeInTheDocument()
  })

  it('wires coverage badges to their fix-list pages', async () => {
    const { container } = await renderWithClient(
      <PnlWaterfall pnl={waterfallPnl('unavailable')} />,
    )
    // fees.withoutFee = 10 in the fixture → the Gateway fees badge links out.
    const feeBadge = [...container.querySelectorAll('a')].find((a) =>
      (a.getAttribute('aria-label') ?? '').startsWith('Gateway fees'),
    )
    expect(feeBadge?.getAttribute('href')).toBe('/mon/analytics/sales')
  })
})

// ─── Component-once ledger: collapsed by default ─────────────────────────────

describe('ComponentOnceLedger', () => {
  it('renders collapsed with the Net Profit row as summary', async () => {
    const { container } = await renderWithClient(<ComponentOnceLedger pnl={waterfallPnl('unavailable')} />)
    const details = container.querySelector('[data-testid="component-ledger"]')
    expect(details?.hasAttribute('open')).toBe(false)
    const summary = details?.querySelector('summary')?.textContent ?? ''
    expect(summary).toContain('= Net Profit')
    expect(summary).toContain('৳28,100')
  })
})

// ─── Single meta footer ──────────────────────────────────────────────────────

describe('MetricMetaFooter', () => {
  it('renders the whole meta as one line', async () => {
    const { container, getByText } = await renderWithClient(
      <MetricMetaFooter formulaVersion="v9" dataAsOf="2026-01-01" dateBasis="Delivered" ladderState="actual" periodDays={30} />,
    )
    expect(container.querySelectorAll('p')).toHaveLength(1)
    await expect.element(getByText(/Formula v9 · Data as of 2026-01-01/)).toBeInTheDocument()
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
    await userEvent.click(getByText(/More filters/))
    await userEvent.fill(getByPlaceholder('slug / utm_source'), 'facebook')
    expect(seen.marketingSource).toBe('facebook')
    expect(seen.preset).toBe('last_30_days')
  })

  it('collapses secondary dims behind More filters with an active count', async () => {
    const { container, getByText } = await renderWithClient(
      <AnalyticsFilterBar value={{ preset: 'last_30_days', location: 'Dhaka' }} onChange={() => {}} />,
    )
    await expect.element(getByText('More filters (1)', { exact: true })).toBeInTheDocument()
    expect(container.querySelector('input[placeholder="slug / utm_source"]')).toBeNull()
    await userEvent.click(getByText('More filters (1)', { exact: true }))
    expect(container.querySelector('input[placeholder="slug / utm_source"]')).not.toBeNull()
  })

  it('shows a Category loading state instead of a silent All', async () => {
    const { categoriesApi } = await import('@/features/categories/api')
    vi.mocked(categoriesApi.list).mockReturnValueOnce(new Promise(() => {}))
    const { getByText } = await renderWithClient(
      <AnalyticsFilterBar value={{ preset: 'last_30_days' }} onChange={() => {}} />,
    )
    await userEvent.click(getByText(/More filters/))
    await expect.element(getByText('Loading…', { exact: true })).toBeInTheDocument()
  })

  it('populates categories from the bare-array GET /categories response', async () => {
    // P10b live find: the backend returns Category[] (no paginated envelope);
    // the filter bar must normalize instead of failing the query with
    // undefined data (which left the Category dimension empty).
    const { categoriesApi } = await import('@/features/categories/api')
    vi.mocked(categoriesApi.list).mockResolvedValueOnce({
      data: [
        { id: 'c1', name: 'Beverages' },
        { id: 'c2', name: 'Snacks' },
      ],
    } as any)
    const { getByText } = await renderWithClient(
      <AnalyticsFilterBar value={{ preset: 'last_30_days' }} onChange={() => {}} />,
    )
    // Category dimension trigger renders (query resolved instead of failing
    // with undefined data); opening it shows the normalized options.
    await userEvent.click(getByText(/More filters/))
    await expect.element(getByText('All categories')).toBeInTheDocument()
    await userEvent.click(getByText('All categories'))
    await expect.element(getByText('Beverages')).toBeInTheDocument()
  })
})

// ─── No nested interactives (W1 review) ─────────────────────────────────────

describe('no nested interactives', () => {
  it('KpiCard drilldownHref wraps the value only — the info button is never inside the anchor', async () => {
    const { container, getByRole } = await renderWithClient(
      <KpiCard
        title="New Customers"
        kpi={kpi({ reason: 'measured' })}
        format={(v) => String(v)}
        drilldownHref="/mon/analytics/customers?segment=new"
      />,
    )
    const link = container.querySelector('a[href="/mon/analytics/customers?segment=new"]')
    expect(link).not.toBeNull()
    // Info control exists and sits outside the link.
    await expect.element(getByRole('button', { name: 'About New Customers' })).toBeInTheDocument()
    expect(container.querySelector('a button')).toBeNull()
  })

  it('HintTooltip renders the info button as the direct trigger (no span>button)', async () => {
    const { container, getByRole } = await renderWithClient(
      <HintTooltip label="About Booked" text="intake only" />,
    )
    await expect.element(getByRole('button', { name: 'About Booked' })).toBeInTheDocument()
    const trigger = container.querySelector('[data-slot="tooltip-trigger"]')
    // asChild: the trigger IS the button — no wrapping span.
    expect(trigger?.tagName).toBe('BUTTON')
    expect(container.querySelectorAll('button')).toHaveLength(1)
  })

  it('InfoDisclosure popover path renders the info button as the direct trigger', async () => {
    const { container, getByRole } = await renderWithClient(
      <InfoDisclosure
        label="About Net Profit"
        lines={['reason line one', 'reason line two', 'reason line three — forces the popover path']}
      />,
    )
    await expect.element(getByRole('button', { name: 'About Net Profit' })).toBeInTheDocument()
    const trigger = container.querySelector('[data-slot="popover-trigger"]')
    // asChild: the trigger IS the button — no wrapping span.
    expect(trigger?.tagName).toBe('BUTTON')
    expect(container.querySelector('a button')).toBeNull()
  })

  it('DataCoverageBadge hint is a controlled tap toggle on a real button', async () => {
    const { container, getByRole, getByText } = await renderWithClient(
      <DataCoverageBadge missing={3} label="Undated spend" title="Consumptions missing spendDate" />,
    )
    const btn = getByRole('button', { name: /Undated spend: 3 missing/ })
    await expect.element(btn).toBeInTheDocument()
    // No legacy span[tabindex] trigger.
    expect(container.querySelector('span[tabindex]')).toBeNull()
    await userEvent.click(btn)
    await expect.element(getByText('Consumptions missing spendDate')).toBeInTheDocument()
  })
})

// ─── Coverage fix-list hrefs unchanged (W1 review) ───────────────────────────

describe('PnlWaterfall coverage hrefs', () => {
  function fullCoveragePnl(): OverviewData['pnl'] {
    const pnl = waterfallPnl('unavailable')
    return {
      ...pnl,
      coverage: {
        cogs: { actualPct: 50, estimatedPct: 0, unavailableUnits: 1, unavailableItems: 2 },
        shipping: { actualOrders: 80, estimatedOrders: 0, unavailableOrders: 3 },
        fees: { paidPayments: 90, withFee: 80, withoutFee: 10 },
        marketing: { datedRows: 5, undatedRows: 4, datedAmount: 5000, undatedAmount: 400 },
        delivery: { onlineOrders: 80, codOrders: 5, collectionUnavailableOrders: 5 },
      },
    }
  }

  it('wires every coverage badge to its canonical fix-list page', async () => {
    const { container } = await renderWithClient(<PnlWaterfall pnl={fullCoveragePnl()} />)
    const byLabel = (prefix: string) =>
      [...container.querySelectorAll('a')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith(prefix))
    expect(byLabel('COGS')?.getAttribute('href')).toBe('/mon/analytics/products')
    expect(byLabel('Shipping cost')?.getAttribute('href')).toBe('/mon/analytics/sales')
    expect(byLabel('Gateway fees')?.getAttribute('href')).toBe('/mon/analytics/sales')
    expect(byLabel('Undated marketing spend')?.getAttribute('href')).toBe(
      '/mon/analytics/marketing#marketing-undated-fixlist',
    )
    expect(byLabel('COD settlement')?.getAttribute('href')).toBe('/mon/analytics/sales')
  })
})

// ─── RecognitionStrip dense cells + overview H1 terminology (W1 review) ──────

describe('RecognitionStrip dense cells', () => {
  const strip = {
    bookedOrders: 120,
    bookedAmount: 250000,
    recognised: 90,
    inFulfilment: 20,
    delivered: 95,
    notYetRecognised: 25,
    recognitionRate: 0.75,
    dateSourceMix: { timeline: 85, dispatch: 5 },
    undatedDeliveries: 2,
  }

  it('truncates dense labels and uses the compact info button', async () => {
    const { container } = await renderWithClient(<RecognitionStrip strip={strip} />)
    // Labels truncate inside min-w-0 cells so the 32px control never crowds 375px 2-col cells.
    const labels = [...container.querySelectorAll('span.truncate')]
    expect(labels.length).toBeGreaterThan(0)
    const compactBtns = [...container.querySelectorAll('button[aria-label^="About"]')].filter((b) =>
      b.className.includes('h-6'),
    )
    expect(compactBtns.length).toBeGreaterThan(0)
  })
})

// ─── Overview H1 canonical terminology (W1 review) ───────────────────────────

describe('overview H1 terminology', () => {
  it('renders the canonical "Business Overview" H1', async () => {
    const { container, getByRole, getByText } = await renderWithClient(<BusinessOverview />)
    await expect.element(getByRole('heading', { level: 1, name: 'Business Overview' })).toBeInTheDocument()
    await expect.element(getByText('Recognised revenue only — Delivered is the recognition event.')).toBeInTheDocument()
    expect(container.textContent).not.toContain('Business Performance')
  })
})
