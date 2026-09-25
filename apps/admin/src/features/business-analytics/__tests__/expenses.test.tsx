/**
 * P9 frontend tests (§7.2 expenses items).
 *
 * Fixed/variable/unclassified split renders · Budget vs Actual renders
 * Unavailable (never ৳0) · drill params (category rows carry categoryId;
 * landing pre-filters the list) · every KpiValue state renders (ok, zero,
 * no_data, not_applicable "—", unavailable, estimated) · query keys carry
 * the category/kind narrow.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  BudgetVsActualCard,
  ExpenseCategoryTable,
  ExpenseListTable,
  ExpenseTrendChart,
  ExpensesListSection,
  ExpensesOverviewCards,
  expensesListHref,
  resolveExpensesDrill,
} from '../expenses'
import ExpensesAnalytics from '../expenses'
import { businessAnalyticsApi } from '../api'
import { KpiCard } from '../components/KpiCard'
import {
  buildExpensesQuery,
  expensesCategoriesQueryKey,
  expensesListQueryKey,
  expensesSummaryQueryKey,
  expensesTrendQueryKey,
} from '../api'
import {
  BUDGET_VS_ACTUAL_NOTE,
  EXPENSE_KIND_NOTE,
} from '../types'
import type {
  AnalyticsFilters,
  ExpensesCategoriesData,
  ExpensesListData,
  ExpensesSummaryData,
  ExpensesTrendData,
  KpiValue,
} from '../types'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const FILTERS: AnalyticsFilters = { preset: 'last_30_days' }

function summaryData(over: Partial<ExpensesSummaryData> = {}): ExpensesSummaryData {
  return {
    periodDays: 30,
    total: kpi({ value: 1350 }),
    byKind: {
      fixed: kpi({ value: 1150 }),
      variable: kpi({ value: 200 }),
      unclassified: kpi({ value: 0, state: 'zero', reason: 'measured zero' }),
    },
    kindNote: EXPENSE_KIND_NOTE,
    expenseRevenue: kpi({ value: 0.135 }),
    perOrder: kpi({ value: 50 }),
    revenue: { netSales: 10000, recognisedOrders: 27, dateBasis: 'Delivered transition' },
    growth: {
      prevTotal: 1000,
      delta: 350,
      deltaPct: 35,
      comparison: { prevStart: '2026-08-01T00:00:00.000Z', prevEnd: '2026-08-31T00:00:00.000Z' },
    },
    budgetVsActual: { value: null, state: 'unavailable', reason: 'No budget model exists' },
    dateBasis: 'expenseDate',
    ...over,
  }
}

function categoriesData(): ExpensesCategoriesData {
  return {
    periodDays: 30,
    rows: [
      { categoryId: 'c1', name: 'Rent', expenseKind: 'fixed', total: 1150, expenses: 2 },
      { categoryId: 'c2', name: 'Fuel', expenseKind: 'variable', total: 200, expenses: 1 },
      { categoryId: 'c3', name: 'Misc', expenseKind: 'unclassified', total: 0, expenses: 0 },
    ],
    total: 3,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    dateBasis: 'expenseDate',
  }
}

function listData(): ExpensesListData {
  return {
    periodDays: 30,
    rows: [
      {
        id: 'e1',
        description: 'Office rent',
        amount: 1000,
        taxAmount: 150,
        total: 1150,
        expenseDate: '2026-09-02T10:00:00.000Z',
        referenceNo: 'REF-1',
        category: { id: 'c1', name: 'Rent', expenseKind: 'fixed' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    dateBasis: 'expenseDate',
  }
}

function trendData(): ExpensesTrendData {
  return {
    periodDays: 7,
    requestedGranularity: 'day',
    granularity: 'day',
    points: [
      { bucketStart: '2026-09-01T00:00:00.000Z', label: '2026-09-01', amount: 1150, expenses: 1 },
      { bucketStart: '2026-09-02T00:00:00.000Z', label: '2026-09-02', amount: 200, expenses: 1 },
    ],
    dateBasis: 'expenseDate',
  }
}

// ─── split renders ───────────────────────────────────────────────────────────

function kpi(over: Partial<KpiValue>): KpiValue {
  return { value: 1000, state: 'ok', ...over }
}

// ─── split renders ───────────────────────────────────────────────────────────

describe('ExpensesOverviewCards', () => {
  it('renders the fixed/variable/unclassified split with scope in disclosure', async () => {
    const { container, getByRole, getByTestId } = await renderWithClient(<ExpensesOverviewCards summary={summaryData()} />)
    expect(container.querySelector('[data-testid="expenses-overview"]')).not.toBeNull()
    expect(container.textContent).toMatch(/৳1,150/)
    expect(container.textContent).toMatch(/৳200/)
    // Kind note and revenue scope live in disclosure, never captions.
    expect(container.querySelector('[data-testid="kind-note"]')).toBeNull()
    expect(container.querySelector('[data-testid="revenue-scope"]')).toBeNull()
    await userEvent.click(getByRole('button', { name: 'About expense kinds and revenue scope' }))
    await expect.element(getByTestId('expenses-scope-notes')).toHaveTextContent(/never inferred/i)
    await expect.element(getByTestId('expenses-scope-notes')).toHaveTextContent(/Recognised Net Sales/)
  })

  it('renders expense/revenue, per-order and growth with N/A-safe pct', async () => {
    const { container, getByText } = await renderWithClient(<ExpensesOverviewCards summary={summaryData()} />)
    await expect.element(getByText('13.5%')).toBeInTheDocument()
    expect(container.textContent).toMatch(/৳50/)
    expect(container.querySelector('[data-testid="expenses-growth"]')?.textContent).toMatch(/\+৳350/)
  })

  it('renders a null pct growth as — (never 0%/Infinity)', async () => {
    const { container } = await renderWithClient(
      <ExpensesOverviewCards summary={summaryData({ growth: { prevTotal: 0, delta: 1350, deltaPct: null, comparison: { prevStart: '', prevEnd: '' } } })} />,
    )
    expect(container.querySelector('[data-testid="expenses-growth"]')?.textContent).toMatch(/—/)
  })

  it('renders withheld ratios as Unavailable, never ৳0', async () => {
    const { container } = await renderWithClient(
      <ExpensesOverviewCards
        summary={summaryData({
          byKind: {
            fixed: kpi({ value: 1150 }),
            variable: kpi({ value: 200 }),
            unclassified: { value: null, state: 'no_data', reason: 'no expenses in range' },
          },
          expenseRevenue: { value: null, state: 'unavailable', reason: 'Net Sales ≤ 0 in range' },
          perOrder: { value: null, state: 'unavailable', reason: 'no recognised orders in range' },
        })}
      />,
    )
    // Real splits still render; the withheld ratios render words with reasons.
    expect(container.textContent).toMatch(/৳1,150/)
    expect(container.textContent).toMatch(/Net Sales ≤ 0 in range/)
    expect(container.textContent).toMatch(/no recognised orders in range/)
    expect(container.textContent).not.toMatch(/৳0/)
  })
})

// ─── budget card ─────────────────────────────────────────────────────────────

describe('BudgetVsActualCard', () => {
  it('renders Unavailable with the no-budget-model note — never ৳0', async () => {
    const { container } = await renderWithClient(
      <BudgetVsActualCard kpi={{ value: null, state: 'unavailable', reason: 'No budget model exists' }} />,
    )
    expect(container.querySelector('[data-testid="budget-vs-actual"]')).not.toBeNull()
    expect(container.textContent).toMatch(/Unavailable/)
    expect(container.textContent).toMatch(/No budget model exists/)
    expect(container.textContent).not.toMatch(/৳0/)
  })

  it('is a compact line, not a full card slot', async () => {
    const { container } = await renderWithClient(
      <BudgetVsActualCard kpi={{ value: null, state: 'unavailable', reason: 'No budget model exists' }} />,
    )
    const el = container.querySelector('[data-testid="budget-vs-actual"]')
    expect(el?.tagName).toBe('DIV')
    expect(el?.closest('.chart-card')).toBeNull()
  })
})

// ─── trend / tables ──────────────────────────────────────────────────────────

describe('ExpenseTrendChart', () => {
  it('renders buckets at the backend granularity', async () => {
    const { container } = await renderWithClient(<ExpenseTrendChart trend={trendData()} />)
    expect(container.querySelector('[data-testid="expenses-trend"]')).not.toBeNull()
    expect(container.textContent).toMatch(/Auto-granularity: day/)
  })
})

describe('expense date basis (single source)', () => {
  it('states the date basis once — trend keeps it, tables disclose it', async () => {
    const trend = await renderWithClient(<ExpenseTrendChart trend={trendData()} />)
    expect(trend.container.textContent).toMatch(/expenseDate/)
    const cats = await renderWithClient(<ExpenseCategoryTable data={categoriesData()} />)
    expect(cats.container.textContent).not.toMatch(/expenseDate/)
    const list = await renderWithClient(<ExpenseListTable data={listData()} />)
    expect(list.container.textContent).not.toMatch(/expenseDate/)
    expect(list.container.textContent).toMatch(/incl\. tax/)
  })
})

describe('ExpenseCategoryTable', () => {
  it('renders kind badges with drill links carrying the categoryId', async () => {
    const { container } = await renderWithClient(<ExpenseCategoryTable data={categoriesData()} />)
    expect(container.querySelector('[data-testid="category-row-c1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="category-drill-c1"]')?.getAttribute('href')).toBe(expensesListHref('c1'))
    expect(container.textContent).toMatch(/unclassified/)
  })
})

describe('ExpenseListTable', () => {
  it('renders row amounts incl. tax with the category kind', async () => {
    const { container } = await renderWithClient(<ExpenseListTable data={listData()} />)
    expect(container.querySelector('[data-testid="expense-row-e1"]')).not.toBeNull()
    expect(container.textContent).toMatch(/৳1,150/)
    expect(container.textContent).toMatch(/REF-1/)
  })

  it('keeps the category kind as quiet text — never a hover-only title', async () => {
    const { container } = await renderWithClient(<ExpenseListTable data={listData()} />)
    expect(container.textContent).toMatch(/fixed/)
    expect(container.querySelector('[title]')).toBeNull()
  })
})

// ─── drill params ────────────────────────────────────────────────────────────

describe('expenses drill landing', () => {
  it('builds list hrefs with view=list and the category narrow', () => {
    expect(expensesListHref('c1')).toBe('/mon/analytics/expenses?view=list&categoryId=c1')
  })

  it('focuses the list on view=list or a bare categoryId', () => {
    expect(resolveExpensesDrill({ view: 'list' }).focusList).toBe(true)
    expect(resolveExpensesDrill({ categoryId: 'c1' })).toEqual({ focusList: true, categoryId: 'c1' })
    expect(resolveExpensesDrill(undefined).focusList).toBe(false)
    expect(resolveExpensesDrill({}).focusList).toBe(false)
  })

  it('marks and announces the focused list section', async () => {
    const { container } = await renderWithClient(
      <ExpensesListSection data={listData()} focus categoryId="c1" />,
    )
    expect(container.querySelector('[data-testid="expenses-list-section"]')?.getAttribute('data-focus')).toBe('true')
    // Category resolves to its human name from the rows, not the raw id.
    expect(container.querySelector('[data-testid="expenses-list-focus-note"]')?.textContent).toMatch(/Rent/)
  })

  it('falls back to the raw id when the category is not in the rows', async () => {
    const { container } = await renderWithClient(
      <ExpensesListSection data={listData()} focus categoryId="c9" />,
    )
    expect(container.querySelector('[data-testid="expenses-list-focus-note"]')?.textContent).toMatch(/c9/)
  })

  it('pre-filters the list query by the drill category', async () => {
    const scope = vi.spyOn(businessAnalyticsApi, 'getExpensesList').mockResolvedValue({ data: { data: listData(), meta: {} } } as any)
    vi.spyOn(businessAnalyticsApi, 'getExpensesSummary').mockResolvedValue({ data: { data: summaryData(), meta: {} } } as any)
    vi.spyOn(businessAnalyticsApi, 'getExpensesTrend').mockResolvedValue({ data: { data: trendData(), meta: {} } } as any)
    vi.spyOn(businessAnalyticsApi, 'getExpensesCategories').mockResolvedValue({ data: { data: categoriesData(), meta: {} } } as any)
    await renderWithClient(<ExpensesAnalytics initialSearch={{ view: 'list', categoryId: 'c1' }} />)
    await vi.waitFor(() => {
      expect(scope).toHaveBeenCalled()
    })
    const filters = scope.mock.calls[0][0] as AnalyticsFilters
    expect(filters.expenseCategoryId).toBe('c1')
  })

  it('renders a single metadata footer (no WidgetShell duplication)', async () => {
    const meta = {
      formulaVersion: 'analytics-p2/1.0',
      dataAsOf: '2026-09-21T00:00:00.000Z',
      dateBasis: 'expenseDate',
      ladderState: 'actual',
      range: { periodDays: 30 },
    } as any
    vi.spyOn(businessAnalyticsApi, 'getExpensesSummary').mockResolvedValue({ data: { data: summaryData(), meta } } as any)
    vi.spyOn(businessAnalyticsApi, 'getExpensesTrend').mockResolvedValue({ data: { data: trendData(), meta } } as any)
    vi.spyOn(businessAnalyticsApi, 'getExpensesCategories').mockResolvedValue({ data: { data: categoriesData(), meta } } as any)
    vi.spyOn(businessAnalyticsApi, 'getExpensesList').mockResolvedValue({ data: { data: listData(), meta } } as any)
    const { container } = await renderWithClient(<ExpensesAnalytics initialSearch={{}} />)
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="expenses-list-section"]')).not.toBeNull(),
    )
    expect(container.textContent?.match(/Formula /g) ?? []).toHaveLength(1)
  })
})

// ─── KpiValue states ─────────────────────────────────────────────────────────

describe('KpiCard states on the expenses page', () => {
  it.each([
    ['ok', '৳1,000'],
    ['zero', '৳0'],
    ['no_data', 'No data'],
    ['not_applicable', '—'],
    ['unavailable', 'Unavailable'],
    ['estimated', 'Estimated'],
  ])('renders %s', async (state, text) => {
    const { container } = await renderWithClient(
      <KpiCard title={`T-${state}`} kpi={{ value: state === 'ok' || state === 'estimated' || state === 'zero' ? 1000 : null, state: state as KpiValue['state'], reason: `why-${state}` }} />,
    )
    expect(container.textContent).toContain(text)
    // Every non-ok state carries its reason; ok renders the bare figure.
    if (state !== 'ok') expect(container.textContent).toContain(`why-${state}`)
  })
})

// ─── query keys ──────────────────────────────────────────────────────────────

describe('expenses query keys', () => {
  it('carry the category/kind narrow so the narrow changes the request', () => {
    const narrow: AnalyticsFilters = { ...FILTERS, expenseCategoryId: 'c1', expenseKind: 'fixed' }
    expect(buildExpensesQuery(narrow)).toMatchObject({ expenseCategoryId: 'c1', expenseKind: 'fixed' })
    expect(JSON.stringify(expensesSummaryQueryKey(narrow))).toContain('c1')
    expect(JSON.stringify(expensesTrendQueryKey(narrow))).toContain('fixed')
    expect(JSON.stringify(expensesCategoriesQueryKey(narrow, 1, 20))).toContain('c1')
    expect(JSON.stringify(expensesListQueryKey(narrow, 2, 20))).toContain('2')
  })

  it('drops empty narrow values, never sends them', () => {
    expect(buildExpensesQuery({ ...FILTERS, expenseCategoryId: '', expenseKind: undefined })).not.toContain('expenseCategoryId')
  })
})
