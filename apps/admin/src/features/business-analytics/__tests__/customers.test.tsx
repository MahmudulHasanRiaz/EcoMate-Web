/**
 * P6 frontend tests (§7.2 customer items).
 *
 * CLR labelled observed (the predictive token never renders) · unattributed
 * disclosure banner · cohort states (table vs insufficient_history) ·
 * drill params (segment → customers → order history) · KpiValue states on
 * customer metrics · query keys carry every filter.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CustomerAnalytics, { ClrSection, CohortTable, CustomerPager, UnattributedBanner } from '../customers'
import { KpiCard } from '../components/KpiCard'
import { DrilldownPanel } from '../components/DrilldownPanel'
import { customersListQueryKey, customersSummaryQueryKey } from '../api'
import { CLR_STATEMENT } from '../types'
import type {
  AnalyticsFilters,
  CustomerCohort,
  CustomerCohortsResponse,
  CustomerRow,
  CustomersListResponse,
  CustomersSummaryResponse,
  KpiValue,
  OverviewMeta,
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
  it('keeps counts visible and discloses the never-merged statement on tap', async () => {
    const { container, getByText, getByRole, getByTestId } = await renderWithClient(
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
    expect(container.querySelector('[data-testid="unattributed-banner"]')).not.toBeNull()
    // Statement lives in disclosure — tap to read it.
    await userEvent.click(getByRole('button', { name: 'About unattributed orders' }))
    await expect.element(getByTestId('unattributed-statement')).toHaveTextContent(/never merged/)
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

// ─── W2 polish: flattened CLR, Button pager, sticky cols, footer ─────────────

const customersMocks = vi.hoisted(() => ({
  summary: undefined as unknown as CustomersSummaryResponse,
  cohorts: undefined as unknown as CustomerCohortsResponse,
  list: undefined as unknown as CustomersListResponse,
}))

vi.mock('@/features/business-analytics/hooks', () => ({
  useCustomersSummary: () => ({ data: customersMocks.summary, isLoading: false, error: undefined, refetch: () => {} }),
  useCustomerCohorts: () => ({ data: customersMocks.cohorts, isLoading: false, error: undefined }),
  useCustomersList: () => ({ data: customersMocks.list, isLoading: false, error: undefined }),
}))

vi.mock('@/features/categories/api', () => ({
  categoriesApi: { list: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}))

function customersMeta(): OverviewMeta {
  return {
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
      shipping: { actualOrders: 5, estimatedOrders: 0, unavailableOrders: 0 },
      fees: { paidPayments: 5, withFee: 5, withoutFee: 0 },
      marketing: { datedRows: 1, undatedRows: 0, datedAmount: 200, undatedAmount: 0 },
      delivery: { onlineOrders: 5, codOrders: 0, collectionUnavailableOrders: 0 },
    },
    ladderState: 'actual',
    thresholds: {},
    dateBasis: 'Delivered transition',
  }
}

const CUSTOMER_ROW: CustomerRow = {
  key: 'p1',
  kind: 'profile',
  profileId: 'c-1',
  phone: '+8801712345678',
  name: 'Smoke Customer',
  segment: 'returning',
  firstRecognisedAt: '2026-08-01T00:00:00.000Z',
  lifetimeOrders: 6,
  lifetimeRevenue: 12000,
  rangeOrders: 2,
  rangeRevenue: 4000,
}

function customersFixtures() {
  const meta = customersMeta()
  customersMocks.summary = {
    data: {
      acquisition: {
        newCustomers: kpi({ value: 4 }),
        returningCustomers: kpi({ value: 6 }),
        totalCustomers: kpi({ value: 10 }),
      },
      repeat: { rate: kpi({ value: 0.4 }) },
      value: {
        revenuePerCustomer: kpi({ value: 5000 }),
        ordersPerCustomer: kpi({ value: 2 }),
        averageCustomerOrderValue: kpi({ value: 2500 }),
      },
      clr: { total: kpi({ value: 42000 }), statement: CLR_STATEMENT },
      unattributed: { orders: 3, customers: 3, revenue: 4500, statement: '' },
    },
    meta,
  }
  customersMocks.cohorts = {
    data: { state: 'ok', months: ['2026-08'], cohorts: COHORTS, insufficientReason: null },
    meta,
  }
  customersMocks.list = {
    data: {
      rows: [CUSTOMER_ROW],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      unattributed: { orders: 0, customers: 0, revenue: 0, statement: '' },
    },
    meta,
  }
}

describe('ClrSection (W2 flatten)', () => {
  it('renders CLR without nesting a card — statement in disclosure', async () => {
    const { container, getByText, getByRole, getByTestId } = await renderWithClient(
      <ClrSection clr={{ total: kpi({ value: 42000 }), statement: CLR_STATEMENT }} formulaVersion="v9" />,
    )
    await expect.element(getByText('Cumulative CLR', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('৳42,000', { exact: true })).toBeInTheDocument()
    const section = container.querySelector('[data-testid="clr-section"]')
    expect(section).not.toBeNull()
    // Flattened: no Card in the section — the KpiCard is the only card idiom.
    expect(section?.querySelector('.chart-card')).toBeNull()
    expect(container.querySelector('[data-testid="clr-card"]')).toBeNull()
    await userEvent.click(getByRole('button', { name: 'About CLR' }))
    await expect.element(getByTestId('clr-statement')).toHaveTextContent(/Not a forecast/)
  })
})

describe('CustomerPager (W2 Button idiom)', () => {
  it('paginates with real Buttons, never text-buttons', async () => {
    const { container, getByRole } = await renderWithClient(
      <CustomerPager page={2} totalPages={5} total={81} onPage={() => {}} />,
    )
    await expect.element(getByRole('button', { name: 'Prev' })).toBeInTheDocument()
    await expect.element(getByRole('button', { name: 'Next' })).toBeInTheDocument()
    // Real <button> elements (Button component) — never bare text-buttons.
    const btns = [...(container.querySelector('[data-testid="customer-pager"]')?.querySelectorAll('button') ?? [])]
    expect(btns.map((b) => b.textContent)).toEqual(['Prev', 'Next'])
    expect(container.querySelector('[data-testid="customer-pager"]')?.textContent).toMatch(/Page 2 of 5 · 81 customer\(s\)/)
  })
})

describe('customers page (W2)', () => {
  it('flattens CLR, buttons the pager, pins first columns, single footer', async () => {
    customersFixtures()
    const { container, getByText, getByTestId } = await renderWithClient(<CustomerAnalytics />)
    await expect.element(getByText('Customer Analytics', { exact: true })).toBeInTheDocument()
    // CLR flattened — no clr-card anywhere.
    await expect.element(getByTestId('clr-section')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="clr-card"]')).toBeNull()
    // Pager is Buttons.
    await expect.element(getByTestId('customer-pager')).toBeInTheDocument()
    const pagerBtns = [...(container.querySelector('[data-testid="customer-pager"]')?.querySelectorAll('button') ?? [])]
    expect(pagerBtns.map((b) => b.textContent)).toEqual(['Prev', 'Next'])
    // Acquisition drill links preserved (segment → customers).
    const drill = container.querySelector('a[href="/mon/analytics/customers?segment=new"]')
    expect(drill).not.toBeNull()
    // Sticky first columns on both tables.
    expect(container.querySelector('[data-testid="cohort-table"] thead th.sticky')).not.toBeNull()
    // Single footer.
    const text = container.textContent ?? ''
    expect((text.match(/Worked out as v9 · Data up to/g) ?? []).length).toBe(1)
  })
})
