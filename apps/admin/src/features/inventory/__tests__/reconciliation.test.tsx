import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Reconciliation } from '../reconciliation'

/**
 * Reconciliation page tests (2026-10-30 directive §2.8): the page is
 * hidden without run_stock_reconciliation, and Apply stays disabled
 * until preview + backupId + confirmation are all present.
 */

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: mockPost, put: vi.fn(), delete: vi.fn() },
}))

const authState = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({ auth: { user: { permissions: authState.permissions } } }),
}))

const REPORT = {
  generatedAt: '2026-10-30T10:00:00.000Z',
  imEnabled: true,
  rows: [
    {
      id: 'R1|r1|p1|v1|managed',
      category: 'R1',
      orderDisplayId: 'ORD-1',
      returnDisplayId: 'RTN-1',
      productName: 'Hoodie',
      variantId: 'v1',
      layer: 'managed',
      orderedQty: 2,
      receivedGoodQty: 2,
      damagedQty: 0,
      alreadyRestoredManaged: 0,
      alreadyRestoredPhysical: 2,
      missingManagedQty: 2,
      missingPhysicalQty: 0,
      evidence: 'managed RETURN ledger Σ=0',
    },
    {
      id: 'R4|r9|p1||managed',
      category: 'R4',
      orderDisplayId: 'ORD-9',
      returnDisplayId: 'RTN-9',
      productName: 'Mug',
      variantId: null,
      layer: 'managed',
      orderedQty: 1,
      receivedGoodQty: 0,
      damagedQty: 0,
      alreadyRestoredManaged: 0,
      alreadyRestoredPhysical: 0,
      missingManagedQty: 0,
      missingPhysicalQty: 0,
      evidence: 'quantity unknowable',
    },
  ],
  counts: { R1: 1, R2: 0, R3: 0, R4: 1, R5: { returnPending: 2 } },
  checks: [
    { key: 'Q1', label: 'Managed adds missing', value: 1, pass: false, detail: 'one row' },
    { key: 'Q8', label: 'Ledger-vs-state', value: 0, pass: true, detail: 'caveat' },
  ],
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Reconciliation />
    </QueryClientProvider>,
  )
}

describe('Reconciliation page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.permissions = []
    mockPost.mockImplementation((url: string) => {
      if (url === '/inventory/reconcile') return Promise.resolve({ data: REPORT })
      if (url === '/inventory/reconcile/apply')
        return Promise.resolve({
          data: {
            runId: 'run-1',
            applied: ['R1|r1|p1|v1|managed'],
            skipped: [],
            checks: REPORT.checks,
            idempotency: { ok: true, remainingR1R2: 0 },
          },
        })
      return Promise.reject(new Error('unknown url ' + url))
    })
  })

  it('hides the tool without the run_stock_reconciliation permission', async () => {
    renderPage()
    await expect
      .element(page.getByText(/do not have access to stock reconciliation/i))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /run report/i }))
      .not.toBeInTheDocument()
  })

  it('shows the danger banner and keeps Apply disabled until preview + backup + confirm', async () => {
    authState.permissions = ['run_stock_reconciliation']
    renderPage()
    await expect.element(page.getByText(/Danger: Apply writes real stock/i)).toBeInTheDocument()

    // Run the dry-run report.
    await userEvent.click(page.getByRole('button', { name: /run report/i }))
    await expect.element(page.getByText('RTN-1')).toBeInTheDocument()
    await expect.element(page.getByText(/R1 missed restock: 1/i)).toBeInTheDocument()

    const applyBtn = page.getByRole('button', { name: /Apply 1 selected/i })
    await expect.element(applyBtn).toBeDisabled()

    // R1 row selectable (pre-checked); R4 row never selectable.
    const r1Checkbox = page.getByRole('checkbox', { name: /Select row R1/i })
    await expect.element(r1Checkbox).toBeChecked()
    const r4Checkbox = page.getByRole('checkbox', { name: /Select row R4/i })
    await expect.element(r4Checkbox).toBeDisabled()

    // Backup id alone is not enough — confirmation is also required.
    await userEvent.fill(page.getByLabelText(/Backup id/i), 'dump-42')
    await expect.element(applyBtn).toBeDisabled()
    await userEvent.click(page.getByText(/I reviewed the preview/i))
    await expect.element(applyBtn).not.toBeDisabled()

    await userEvent.click(applyBtn)
    await expect.element(page.getByText(/Apply result \(run run-1\)/i)).toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconcile/apply',
      { backupId: 'dump-42', rowIds: ['R1|r1|p1|v1|managed'], confirmed: true },
      expect.anything(),
    )
  })
})
