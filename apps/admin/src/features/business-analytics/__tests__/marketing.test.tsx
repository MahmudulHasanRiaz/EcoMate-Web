/**
 * P7 frontend tests (§7.2 marketing items).
 *
 * Spend-date basis stated · undated fix-list (reference-only allocatedAt +
 * sync/replay actions) · expected-mismatch disclosure (§8.13) · campaign
 * tree bases · drill params (marketing rows) · KpiValue states on the cost
 * line · query keys carry every filter.
 */
import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AttributionMismatchNotice,
  CampaignTree,
  SpendDateBasisBanner,
  UndatedFixList,
} from '../marketing'
import { KpiCard } from '../components/KpiCard'
import { DrilldownPanel } from '../components/DrilldownPanel'
import {
  marketingCampaignsQueryKey,
  marketingSummaryQueryKey,
  marketingUndatedQueryKey,
} from '../api'
import type {
  AnalyticsFilters,
  KpiValue,
  MarketingCostBlock,
  MarketingTreeCampaign,
  MarketingUndatedData,
} from '../types'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function kpi(over: Partial<KpiValue>): KpiValue {
  return { value: 500, state: 'ok', ...over }
}

const FILTERS: AnalyticsFilters = { preset: 'last_30_days' }

const COST: MarketingCostBlock = {
  total: kpi({ value: 500, state: 'ok', dateBasis: 'spendDate only' }),
  datedRows: 2,
  undatedRows: 1,
  datedAmount: 500,
  undatedAmount: 200,
  estimatedReference: {
    label: 'spend-date fix-list reference only — not a financial period date',
    excludedFromTotal: true,
  },
  basisStatement:
    'P&L Marketing Cost counts Σ MarketingConsumption.calculatedCost dated by spendDate only. Rows with no spendDate are excluded from every period total.',
  allocatedAtNote:
    'allocatedAt and calculatedAt are never financial dates — shown as reference only, excluded from every total.',
}

// ─── spend-date basis statements ─────────────────────────────────────────────

describe('SpendDateBasisBanner', () => {
  it('states the spend-date basis and the allocatedAt honesty note', async () => {
    const { container, getByText } = await renderWithClient(<SpendDateBasisBanner cost={COST} />)
    await expect.element(getByText(/dated by spendDate only/)).toBeInTheDocument()
    await expect.element(getByText(/never financial dates/)).toBeInTheDocument()
    await expect.element(getByText('৳500', { exact: true })).toBeInTheDocument()
    expect(container.querySelector('[data-testid="spend-date-basis"]')).not.toBeNull()
  })

  it('links the coverage badge to the undated fix-list', async () => {
    const { container } = await renderWithClient(<SpendDateBasisBanner cost={COST} />)
    const link = container.querySelector('a[href="#marketing-undated-fixlist"]')
    expect(link).not.toBeNull()
    expect(container.textContent).toMatch(/Undated spend/)
  })
})

// ─── KpiValue states on the cost line ────────────────────────────────────────

describe('marketing cost KpiValue states', () => {
  it('renders unavailable with words, never ৳0, when undated rows exist', async () => {
    const { container, getByText } = await renderWithClient(
      <KpiCard
        title="Marketing Cost"
        kpi={{ value: 500, state: 'unavailable', reason: '1 consumption(s) missing spendDate (৳200)', dateBasis: 'spendDate only' }}
      />,
    )
    await expect.element(getByText('Unavailable', { exact: true })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/৳500/)
  })

  it('renders not_applicable as —, visually distinct from unavailable', async () => {
    const { container, getByText } = await renderWithClient(
      <KpiCard title="Other Costs" kpi={{ value: null, state: 'not_applicable', reason: 'no data source exists' }} />,
    )
    await expect.element(getByText('—', { exact: true })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Unavailable/)
  })
})

// ─── undated fix-list ────────────────────────────────────────────────────────

const UNDATED: MarketingUndatedData = {
  rows: [
    {
      id: 'mc1',
      campaignId: 'c1',
      campaignName: 'Camp One',
      calculatedCost: 200,
      source: 'spend_sync',
      allocatedAt: '2026-09-10T10:00:00.000Z',
      allocatedAtCaption: 'allocatedAt reference only — not a financial period date',
      estimatedReference: {
        label: 'allocatedAt reference only — not a financial period date',
        excludedFromTotal: true,
      },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  totalAmount: 200,
  undatedRows: 1,
  fixActions: [
    { label: 'Resync spend', href: '/op/marketing/spend-snapshots' },
    { label: 'Replay allocations', href: '/op/marketing/attribution' },
  ],
  allocatedAtNote:
    'allocatedAt and calculatedAt are never financial dates — shown as reference only, excluded from every total.',
}

describe('UndatedFixList', () => {
  it('renders rows with the reference-only caption and sync/replay actions', async () => {
    const { container, getByText } = await renderWithClient(
      <UndatedFixList data={UNDATED} page={1} onPage={() => {}} />,
    )
    await expect.element(getByText('Camp One', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/reference only — not a financial period date/)).toBeInTheDocument()
    await expect.element(getByText(/reference only — excluded from total/)).toBeInTheDocument()
    const resync = container.querySelector('[data-testid="fix-action-Resync spend"]')
    const replay = container.querySelector('[data-testid="fix-action-Replay allocations"]')
    expect(resync?.getAttribute('href')).toBe('/op/marketing/spend-snapshots')
    expect(replay?.getAttribute('href')).toBe('/op/marketing/attribution')
    expect(container.querySelector('[data-testid="undated-row-mc1"]')).not.toBeNull()
  })

  it('paginates with page totals', async () => {
    const { getByText } = await renderWithClient(
      <UndatedFixList data={{ ...UNDATED, total: 41, totalPages: 3 }} page={1} onPage={() => {}} />,
    )
    await expect.element(getByText(/Page 1 of 3 · 41 row\(s\)/)).toBeInTheDocument()
  })
})

// ─── expected-mismatch disclosure (§8.13) ────────────────────────────────────

describe('AttributionMismatchNotice', () => {
  it('explains that a period mismatch vs P&L is expected by design', async () => {
    const { container, getByText } = await renderWithClient(
      <AttributionMismatchNotice
        disclosure="Attribution views sit on their own date basis (insight date and attribution date), not the P&L spend-date basis. A period-by-period mismatch against P&L Marketing Cost is expected by design; agreement is verified date-independently (R8)."
      />,
    )
    await expect.element(getByText(/expected by design/)).toBeInTheDocument()
    await expect.element(getByText(/date-independently \(R8\)/)).toBeInTheDocument()
    expect(container.querySelector('[data-testid="attribution-mismatch"]')).not.toBeNull()
  })
})

// ─── campaign tree ───────────────────────────────────────────────────────────

const TREE: MarketingTreeCampaign[] = [
  {
    campaignId: 'c1',
    name: 'Camp One',
    status: 'ACTIVE',
    adAccount: { id: 'a1', name: 'A1', currency: 'BDT' },
    platform: { slug: 'facebook', name: 'Facebook' },
    insights: { spend: 150, impressions: 15, clicks: 3, purchases: 1, purchaseValue: 500 },
    insightsDateBasis: 'insight date (recorded platform snapshot)',
    store: { orders: 2, revenue: 1250 },
    storeDateBasis: 'Order.createdAt — attribution intake basis, not recognition',
    pnlCost: 140,
    pnlDateBasis: 'spendDate only',
    undatedCost: { amount: 20, rows: 1 },
    adSets: [
      {
        adSetId: 's1',
        name: 'Set One',
        status: 'ACTIVE',
        insights: { spend: 150, impressions: 15, clicks: 3, purchases: 1, purchaseValue: 500 },
        store: { orders: 2, revenue: 1250 },
        ads: [
          {
            adId: 'ad1',
            name: 'Ad One',
            status: 'ACTIVE',
            insights: { spend: 150, impressions: 15, clicks: 3, purchases: 1, purchaseValue: 500 },
            store: { orders: 1, revenue: 1000 },
          },
        ],
      },
    ],
  },
]

describe('CampaignTree', () => {
  it('renders campaign → ad set → ad nodes with each level basis stated', async () => {
    const { container, getByText } = await renderWithClient(<CampaignTree campaigns={TREE} />)
    await expect.element(getByText('Camp One', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Set One', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Ad One', { exact: true })).toBeInTheDocument()
    expect(container.querySelector('[data-testid="campaign-node-c1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="adset-node-s1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ad-node-ad1"]')).not.toBeNull()
    expect(container.textContent).toMatch(/insight date/)
    expect(container.textContent).toMatch(/attribution intake basis/)
    expect(container.textContent).toMatch(/spendDate only/)
    expect(container.querySelector('[data-testid="platform-facebook"]')).not.toBeNull()
  })
})

// ─── drill params: §4.2 marketing rows ───────────────────────────────────────

describe('marketing drill-down params', () => {
  it('propagates filters plus the view narrow on drill links', async () => {
    const { container } = await renderWithClient(
      <DrilldownPanel
        filters={{ ...FILTERS, marketingSource: 'facebook' }}
        items={[
          { label: 'Marketing spend → undated-spend fix-list', description: 'd', to: '/op/analytics/marketing', params: { view: 'undated' } },
        ]}
      />,
    )
    const href = container.querySelector('a')?.getAttribute('href') ?? ''
    expect(href).toMatch(/\/op\/analytics\/marketing\?/)
    expect(href).toMatch(/view=undated/)
    expect(href).toMatch(/marketingSource=facebook/)
    expect(href).toMatch(/preset=last_30_days/)
  })
})

// ─── query keys ──────────────────────────────────────────────────────────────

describe('marketing query keys', () => {
  it('carry every filter into summary, campaigns and undated keys', () => {
    const withSource: AnalyticsFilters = { ...FILTERS, marketingSource: 'facebook' }
    expect(JSON.stringify(marketingSummaryQueryKey(withSource))).toMatch(/facebook/)
    expect(JSON.stringify(marketingCampaignsQueryKey(withSource))).toMatch(/facebook/)
    expect(JSON.stringify(marketingUndatedQueryKey(withSource, 2, 20))).toMatch(/facebook/)
    // Page participates: different pages are different keys.
    expect(marketingUndatedQueryKey(FILTERS, 1, 20)).not.toEqual(marketingUndatedQueryKey(FILTERS, 2, 20))
  })
})
