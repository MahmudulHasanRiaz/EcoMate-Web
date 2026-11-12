import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Reconciliation } from '../reconciliation'

/**
 * Reconciliation page tests (2026-10-30 directive §2.8, details sheet
 * 2026-11-12): the page is hidden without run_stock_reconciliation;
 * the details view is a clean sheet — one row per finding, Problem |
 * Order/Item | Qty | Result, plain English, no R-codes, no UUIDs — with
 * the evidence behind each row's expansion; the verification checks
 * hide their detail until expanded; the old Apply and the standalone
 * Q8 settle card are gone (the one-click fix is the only write path).
 * One-click flow (2026-11-12): neutral verdict banner before any report,
 * details closed by default, one "Check & fix stock" button → preview
 * → exactly one confirm → POST /inventory/reconcile/fix-all → result
 * screen with auto-created backup id and a fresh verdict banner.
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
vi.mock('@/components/page-info', () => ({
  PageInfo: ({ text }: { text: string }) => <span aria-label='About this page'>{text}</span>,
}))
vi.mock('@tanstack/react-router', () => ({
  // The result screen links to /mon/backup; navigation is a no-op here.
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: mockPost, put: vi.fn(), delete: vi.fn() },
}))

const authState = vi.hoisted(() => ({ permissions: [] as string[], role: '' as string }))
const flowState = vi.hoisted(() => ({ fixAllShouldFail: false }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({ auth: { user: { permissions: authState.permissions, role: authState.role } } }),
}))

const LONG_DETAIL = 'x'.repeat(500)

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
    {
      id: 'R6|p6||managed',
      category: 'R6',
      orderDisplayId: '—',
      returnDisplayId: null,
      productName: 'Stranded Widget',
      variantId: null,
      layer: 'managed',
      orderedQty: 0,
      receivedGoodQty: 0,
      damagedQty: 0,
      alreadyRestoredManaged: 0,
      alreadyRestoredPhysical: 0,
      missingManagedQty: 0,
      missingPhysicalQty: 0,
      evidence: 'IC product with managed residue −2',
    },
    {
      id: 'R8|o8||||managed',
      category: 'R8',
      r8Kind: 'terminal',
      orderDisplayId: 'ORD-8',
      returnDisplayId: null,
      productName: 'Legacy Returned Item',
      variantId: null,
      layer: 'managed',
      orderedQty: 1,
      receivedGoodQty: 0,
      damagedQty: 0,
      alreadyRestoredManaged: 0,
      alreadyRestoredPhysical: 0,
      missingManagedQty: 0,
      missingPhysicalQty: 0,
      evidence: 'legacy return — no Return record (terminal evidence)',
    },
    {
      id: 'R8|o9||||managed',
      category: 'R8',
      r8Kind: 'human',
      orderDisplayId: 'ORD-10',
      returnDisplayId: null,
      productName: 'Ambiguous Legacy Item',
      variantId: null,
      layer: 'managed',
      orderedQty: 1,
      receivedGoodQty: 0,
      damagedQty: 0,
      alreadyRestoredManaged: 0,
      alreadyRestoredPhysical: 0,
      missingManagedQty: 0,
      missingPhysicalQty: 0,
      evidence: 'legacy return — ambiguous evidence',
    },
  ],
  counts: { R1: 1, R2: 0, R3: 0, R4: 1, R5: { returnPending: 2 }, R6: 1, R7: 0, R8: 1, R8H: 1 },
  checks: [
    { key: 'Q1', label: 'Managed adds missing', value: 1, pass: false, detail: 'one row' },
    { key: 'Q8', label: 'Ledger-vs-state', value: 0, pass: true, detail: LONG_DETAIL },
  ],
}

const FIX_ALL_RESULT = {
  backupId: 'backup-auto-123',
  apply: {
    runId: 'run-fix-1',
    applied: ['R1|r1|p1|v1|managed', 'R6|p6||managed', 'R8|o8||||managed'],
    skipped: [{ id: 's1', reason: 'no longer qualifies' }],
    idempotency: { ok: true, remainingR1R2: 0, remainingR6: 0, remainingR8: 0 },
  },
  postReport: {
    counts: {
      R1: 0,
      R2: 0,
      R3: 0,
      R4: 1,
      R5: { returnPending: 2 },
      R6: 0,
      R7: 0,
      R8: 0,
      R8H: 1,
    },
    checks: [
      { key: 'Q1', label: 'Managed adds missing', value: 0, pass: true, detail: 'clean' },
    ],
  },
  generatedAt: '2026-11-12T10:00:00.000Z',
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
    authState.role = ''
    flowState.fixAllShouldFail = false
    mockPost.mockImplementation((url: string, body?: any) => {
      if (url === '/inventory/reconcile') return Promise.resolve({ data: REPORT })
      if (url === '/inventory/reconcile/fix-all') {
        if (flowState.fixAllShouldFail)
          return Promise.reject({
            response: { data: { message: 'Backup did not finish.' } },
          })
        return Promise.resolve({
          data: {
            ...FIX_ALL_RESULT,
            settle:
              authState.role === 'superadmin'
                ? {
                    ran: true,
                    releasedUnits: 2,
                    flagsCleared: 1,
                    ledgerEntries: ['LED-1'],
                    remainingFails: 0,
                    detail: 'settled 2 orphaned units',
                  }
                : { ran: false, reason: 'Only superadmins can settle orphaned units.' },
          },
        })
      }
      if (url === '/inventory/reconcile/apply')
        return Promise.resolve({
          data: {
            runId: 'run-1',
            applied: ['R1|r1|p1|v1|managed', 'R6|p6||managed', 'R8|o8||||managed'],
            skipped: [],
            checks: REPORT.checks,
            idempotency: { ok: true, remainingR1R2: 0, remainingR6: 0, remainingR8: 0 },
          },
        })
      if (url === '/inventory/reconciliation/q8-settle')
        return Promise.resolve({
          data: {
            dryRun: body?.dryRun ?? false,
            settled: { releasedUnits: 2, flagsCleared: 1, ledgerEntries: ['LED-1'] },
            remainingFails: 0,
            detail: 'settled 2 orphaned units',
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
      .element(page.getByRole('button', { name: /Check & fix stock/i }))
      .not.toBeInTheDocument()
  })

  it('details show the sheet: one row per finding, plain columns, no codes', async () => {
    authState.permissions = ['run_stock_reconciliation']
    renderPage()

    // Load the report through the one-click button (the dry-run).
    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))
    await expect.element(page.getByText(/What will be fixed/i)).toBeInTheDocument()

    await userEvent.click(page.getByRole('button', { name: /Show details/i }))
    await expect.element(page.getByText('Findings (5)')).toBeInTheDocument()

    // One row per finding, plain problems, no R-codes. (Exact match: the
    // preview card above repeats similar words, e.g. "1 missed restock(s)
    // will be added", so a substring match would hit both.)
    await expect.element(page.getByText('Missed restock', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Quantity unknown', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Stranded managed stock', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Old return, no Return record', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Old return, unclear evidence', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('ORD-1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Hoodie', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Stranded Widget', { exact: true })).toBeInTheDocument()

    // Result column: applicable rows Auto-fix, report-only rows Needs you.
    await expect.element(page.getByText('Auto-fix').first()).toBeInTheDocument()
    await expect.element(page.getByText('Needs you').first()).toBeInTheDocument()

    // No R-codes, no UUIDs, no old-UI leftovers anywhere on the page.
    await expect.element(page.getByText(/\bR[1-8](-H)?\b/)).not.toBeInTheDocument()
    await expect.element(page.getByText(/R1 missed restock/i)).not.toBeInTheDocument()
    await expect.element(page.getByText(/R8-H/)).not.toBeInTheDocument()
    await expect.element(page.getByText(/Danger: Apply writes real stock/i)).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /run report/i }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /Apply \d+ selected/i }))
      .not.toBeInTheDocument()

    // Evidence stays reachable behind the row's expansion.
    await userEvent.click(page.getByRole('button', { name: /Details for ORD-1 Hoodie/i }))
    await expect.element(page.getByText(/managed RETURN ledger/i)).toBeInTheDocument()
    await expect.element(page.getByText(/Return: RTN-1/i)).toBeInTheDocument()
  })

  it('shows Unknown product instead of a raw product id, and never shows the id', async () => {
    authState.permissions = ['run_stock_reconciliation']
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    mockPost.mockImplementation((url: string) => {
      if (url === '/inventory/reconcile')
        return Promise.resolve({
          data: {
            ...REPORT,
            rows: [
              {
                id: `R3|${uuid}||managed`,
                category: 'R3',
                orderDisplayId: 'ORD-99',
                returnDisplayId: null,
                productId: uuid,
                productName: uuid,
                variantId: null,
                layer: 'managed',
                orderedQty: 3,
                receivedGoodQty: 0,
                damagedQty: 0,
                alreadyRestoredManaged: 0,
                alreadyRestoredPhysical: 0,
                missingManagedQty: 0,
                missingPhysicalQty: 0,
                evidence: 'Order Cancelled with lingering managed flags',
              },
            ],
            counts: { R1: 0, R2: 0, R3: 1, R4: 0, R5: {}, R6: 0, R7: 0, R8: 0, R8H: 0 },
            checks: [],
          },
        })
      return Promise.reject(new Error('unknown url ' + url))
    })
    renderPage()
    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))
    await userEvent.click(page.getByRole('button', { name: /Show details/i }))
    await expect.element(page.getByText('Unknown product')).toBeInTheDocument()
    await expect.element(page.getByText('Stock flags still set')).toBeInTheDocument()
    await expect.element(page.getByText(uuid)).not.toBeInTheDocument()
  })

  it('hides check details until the row is expanded, keeping the 400-char collapse', async () => {
    authState.permissions = ['run_stock_reconciliation']
    renderPage()
    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))
    await userEvent.click(page.getByRole('button', { name: /Show details/i }))
    await expect.element(page.getByText('Managed adds missing')).toBeInTheDocument()

    // No check codes in the main view — the label is the identifier.
    await expect.element(page.getByText('Q1', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText('Q8', { exact: true })).not.toBeInTheDocument()

    // Compact table: label + count, detail hidden by default.
    await expect.element(page.getByText('one row', { exact: true })).not.toBeInTheDocument()

    await userEvent.click(
      page.getByRole('button', { name: /Details for Managed adds missing/i }),
    )
    await expect.element(page.getByText('one row', { exact: true })).toBeInTheDocument()

    // Long Q8 detail collapses past 400 chars behind "Show full detail".
    await userEvent.click(
      page.getByRole('button', { name: /Details for Ledger-vs-state/i }),
    )
    await expect.element(page.getByRole('button', { name: /Show full detail/i })).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /Show full detail/i }))
    await expect.element(page.getByRole('button', { name: /Show less/i })).toBeInTheDocument()
  })

  it('the standalone Q8 settle card is gone — Q8 settles only inside the one-click fix', async () => {
    authState.permissions = ['run_stock_reconciliation']
    authState.role = 'superadmin'
    renderPage()
    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))
    // The one-click preview still carries the Q8 settle line for superadmins.
    await expect
      .element(page.getByText(/2 stuck reservation\(s\) will be released/i))
      .toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /Show details/i }))
    await expect.element(page.getByText(/Settle orphaned Q8 units/i)).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^Preview$/i }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^Settle$/i }))
      .not.toBeInTheDocument()
  })

  it('details are closed by default and show an empty state until a report is loaded', async () => {
    authState.permissions = ['run_stock_reconciliation']
    renderPage()
    await expect.element(page.getByText(/Not checked yet/i)).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /Check & fix stock/i }))
      .toBeInTheDocument()
    // Details hidden until opened; the old Run report button is gone.
    await expect
      .element(page.getByRole('button', { name: /run report/i }))
      .not.toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /Show details/i }))
    await expect.element(page.getByText(/No report yet/i)).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /Hide details/i }))
      .toBeInTheDocument()
  })

  it('one-click flow previews, confirms once and shows the fix-all result', async () => {
    authState.permissions = ['run_stock_reconciliation']
    authState.role = 'admin'
    renderPage()

    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))

    // Preview: plain English lines, no R/Q codes.
    await expect.element(page.getByText(/1 missed restock\(s\) will be added/i)).toBeInTheDocument()
    await expect
      .element(page.getByText(/1 stranded managed stock unit\(s\) will be released/i))
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/A Return record will be created for 1 old order\(s\)/i))
      .toBeInTheDocument()
    await expect.element(page.getByText(/2 item\(s\) need a manual check/i)).toBeInTheDocument()
    // Non-superadmin: no Q8 settle line, and the q8-settle endpoint is
    // never called in the default flow.
    await expect
      .element(page.getByText(/Stuck reservation/i))
      .not.toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalledWith(
      '/inventory/reconciliation/q8-settle',
      expect.anything(),
      expect.anything(),
    )

    // Exactly one explicit confirm: disabled until the checkbox is ticked.
    const fixBtn = page.getByRole('button', { name: /^Fix$/i })
    await expect.element(fixBtn).toBeDisabled()
    await userEvent.click(page.getByText(/I understand/i))
    await expect.element(fixBtn).not.toBeDisabled()

    await userEvent.click(fixBtn)
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconcile/fix-all',
      { confirmed: true },
      expect.anything(),
    )

    // Result screen: applied/skipped, why settle was skipped, auto backup.
    await expect.element(page.getByText(/^Fixed$/i)).toBeInTheDocument()
    await expect.element(page.getByText(/3 row\(s\) fixed/i)).toBeInTheDocument()
    await expect.element(page.getByText(/1 skipped/i)).toBeInTheDocument()
    await expect.element(page.getByText('s1')).toBeInTheDocument()
    await expect.element(page.getByText(/no longer qualifies/i)).toBeInTheDocument()
    await expect
      .element(page.getByText(/Q8 settle did not run: Only superadmins can settle orphaned units\./i))
      .toBeInTheDocument()
    await expect.element(page.getByText('backup-auto-123')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /Copy/i }))
      .toBeInTheDocument()
    await expect.element(page.getByText(/Re-check: all good/i)).toBeInTheDocument()
    // Auto re-run dry-run refreshes the verdict banner (REPORT still has
    // 3 applicable rows + the failing Q1 check = 4 problems).
    await expect.element(page.getByText(/4 problems found/i)).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/inventory/reconcile').length).toBe(2)
  })

  it('one-click flow for superadmin includes the Q8 preview line and settle outcome', async () => {
    authState.permissions = ['run_stock_reconciliation']
    authState.role = 'superadmin'
    renderPage()

    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))
    await expect
      .element(page.getByText(/2 stuck reservation\(s\) will be released/i))
      .toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconciliation/q8-settle',
      { dryRun: true },
      expect.anything(),
    )

    await userEvent.click(page.getByText(/I understand/i))
    await userEvent.click(page.getByRole('button', { name: /^Fix$/i }))
    await expect
      .element(page.getByText(/2 unit\(s\) released, 1 flag\(s\) cleared/i))
      .toBeInTheDocument()
  })

  it('preview says plainly there is nothing to fix and Confirm stays disabled', async () => {
    authState.permissions = ['run_stock_reconciliation']
    mockPost.mockImplementation((url: string) => {
      if (url === '/inventory/reconcile')
        return Promise.resolve({
          data: {
            ...REPORT,
            rows: [],
            counts: { R1: 0, R2: 0, R3: 0, R4: 0, R5: {}, R6: 0, R7: 0, R8: 0, R8H: 0 },
            checks: [{ key: 'Q1', label: 'x', value: 0, pass: true, detail: 'ok' }],
          },
        })
      return Promise.reject(new Error('unknown url ' + url))
    })
    renderPage()

    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))
    await expect.element(page.getByText(/Nothing to fix/i)).toBeInTheDocument()
    await expect.element(page.getByText(/All good/i)).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^Fix$/i }))
      .toBeDisabled()
  })

  it('fix-all error shows the backend message verbatim and states nothing was written', async () => {
    authState.permissions = ['run_stock_reconciliation']
    flowState.fixAllShouldFail = true
    renderPage()

    await userEvent.click(page.getByRole('button', { name: /Check & fix stock/i }))
    await expect.element(page.getByText(/1 missed restock\(s\) will be added/i)).toBeInTheDocument()
    await userEvent.click(page.getByText(/I understand/i))
    await userEvent.click(page.getByRole('button', { name: /^Fix$/i }))

    await expect.element(page.getByText(/Backup did not finish\./i)).toBeInTheDocument()
    await expect.element(page.getByText(/Nothing was written/i)).toBeInTheDocument()
    await expect.element(page.getByText(/Fixed/i)).not.toBeInTheDocument()
  })
})
