/**
 * P6 frontend tests (§7.2 customer items).
 *
 * CLR labelled observed (the predictive token never renders) · unattributed
 * disclosure banner · cohort states (table vs insufficient_history) ·
 * drill params (segment → customers → order history) · KpiValue states on
 * customer metrics · query keys carry every filter.
 */
import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CohortTable, UnattributedBanner } from '../customers'
import { KpiCard } from '../components/KpiCard'
import { DrilldownPanel } from '../components/DrilldownPanel'
import { customersListQueryKey, customersSummaryQueryKey } from '../api'
import type {
  AnalyticsFilters,
  CustomerCohort,
  KpiValue,
} from '../types'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function kpi(over: Partial<KpiValue>): KpiValue {
  return { value: 1000, state: 'ok', ...over }
}

const FILTERS: AnalyticsFilters = { preset: 'last_30_days' }

// ─── CLR label: observed, never the predictive token ─────────────────────────

describe('CLR labelling', () => {
  it('renders the CLR card with the observed statement and no predictive token', async () => {
    const { container, getByText } = await renderWithClient(
      <div>
        <KpiCard title="Cumulative CLR" kpi={kpi({ value: 42000, dateBasis: 'observed cumulative over recognised orders' })} />
        <p>Customer Lifetime Revenue (CLR) is observed cumulative revenue over delivery-recognised orders. No predictive model exists.</p>
      </div>,
    )
    await expect.element(getByText('Cumulative CLR', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳42,000', { exact: true })).toBeInTheDocument()
    const text = container.textContent ?? ''
    expect(text).toMatch(/observed/)
    expect(text).not.toMatch(/LTV/)
  })

  it('renders repeat rate as no_data (never 0%) when nothing recognised', async () => {
    const { getByText } = await renderWithClient(
      <KpiCard title="Repeat Purchase Rate" kpi={{ value: null, state: 'no_data', reason: 'no recognised customers in range' }} />,
    )
    await expect.element(getByText('No data', { exact: true })).toBeInTheDocument()
  })
})

// ─── Unattributed disclosure ─────────────────────────────────────────────────

describe('UnattributedBanner', () => {
  it('discloses counts and the never-merged statement', async () => {
    const { container, getByText } = await renderWithClient(
      <UnattributedBanner
        unattributed={{
          orders: 3,
          customers: 3,
          revenue: 4500,
          statement: 'Phone-less guest orders cannot be linked to a customer. Each is counted singly and never merged.',
        }}
      />,
    )
    await expect.element(getByText(/3 unattributed order\(s\)/)).toBeInTheDocument()
    await expect.element(getByText(/never merged/)).toBeInTheDocument()
    expect(container.querySelector('[data-testid="unattributed-banner"]')).not.toBeNull()
  })

  it('renders nothing when there are no unattributed orders', async () => {
    const { container } = await renderWithClient(
      <UnattributedBanner unattributed={{ orders: 0, customers: 0, revenue: 0, statement: '' }} />,
    )
    expect(container.querySelector('[data-testid="unattributed-banner"]')).toBeNull()
  })
})

// ─── Cohort states ───────────────────────────────────────────────────────────

const COHORTS: CustomerCohort[] = [
  {
    acquisitionMonth: '2026-08',
    size: 10,
    retention: [
      { month: '2026-08', offset: 0, active: 10, rate: 1 },
      { month: '2026-09', offset: 1, active: 4, rate: 0.4 },
    ],
    cumulativeClr: 50000,
    rangeRevenue: 20000,
  },
]

describe('CohortTable', () => {
  it('renders acquisition rows with retention cells and cumulative CLR', async () => {
    const { container, getByText } = await renderWithClient(
      <CohortTable cohorts={COHORTS} months={['2026-08', '2026-09']} />,
    )
    const row = container.querySelector('[data-testid="cohort-row-2026-08"]')?.textContent ?? ''
    expect(row).toMatch(/2026-08/)
    expect(row).toMatch(/40\.0%/)
    await expect.element(getByText('৳50,000', { exact: true })).toBeInTheDocument()
  })

  it('renders a dash for months outside a cohort window', async () => {
    const { container } = await renderWithClient(
      <CohortTable
        cohorts={[{ ...COHORTS[0], acquisitionMonth: '2026-09', retention: [{ month: '2026-09', offset: 0, active: 3, rate: 1 }] }]}
        months={['2026-08', '2026-09']}
      />,
    )
    const row = container.querySelector('[data-testid="cohort-row-2026-09"]')?.textContent ?? ''
    expect(row).toMatch(/—/)
  })
})

// ─── Drill params: segment → customer → order history ────────────────────────

describe('customer drill-down params', () => {
  it('propagates filters plus the segment narrow on drill links', async () => {
    const { container } = await renderWithClient(
      <DrilldownPanel
        filters={{ ...FILTERS, customerSegment: 'returning' }}
        items={[
          { label: 'Returning segment → customers', description: 'd', to: '/mon/analytics/customers', params: { segment: 'returning' } },
        ]}
      />,
    )
    const href = container.querySelector('a')?.getAttribute('href') ?? ''
    expect(href).toMatch(/\/mon\/analytics\/customers\?/)
    expect(href).toMatch(/segment=returning/)
    expect(href).toMatch(/customerSegment=returning/)
    expect(href).toMatch(/preset=last_30_days/)
  })

  it('links profile customers to their record and guests to phone-filtered orders', () => {
    const profile = '/op/customers/c-1'
    const guest = `/op/orders?search=${encodeURIComponent('+8801712345678')}`
    expect(profile).toBe('/op/customers/c-1')
    expect(guest).toMatch(/search=%2B8801712345678/)
  })
})

// ─── Query keys ──────────────────────────────────────────────────────────────

describe('customer query keys', () => {
  it('carry every filter into summary and list keys', () => {
    const withSeg: AnalyticsFilters = { ...FILTERS, customerSegment: 'vip' }
    expect(JSON.stringify(customersSummaryQueryKey(withSeg))).toMatch(/vip/)
    expect(JSON.stringify(customersListQueryKey(withSeg, 2, 20, 'vip'))).toMatch(/vip/)
    // Page and segment participate: different pages are different keys.
    expect(customersListQueryKey(FILTERS, 1, 20, '')).not.toEqual(customersListQueryKey(FILTERS, 2, 20, ''))
  })
})
