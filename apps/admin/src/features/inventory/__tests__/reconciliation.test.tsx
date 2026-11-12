import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Reconciliation } from '../reconciliation'

/**
 * Reconciliation page tests (2026-10-30 directive §2.8, layout redesigned
 * 2026-11-12): the page is hidden without run_stock_reconciliation, Apply
 * stays disabled until preview + backupId + confirmation are all present,
 * checks hide their detail until expanded, and the Q8 settle card is
 * superadmin-only with preview/settle against the q8-settle contract.
 * One-click flow (2026-11-12): neutral verdict banner before any report,
 * details closed by default, one "স্টক যাচাই ও ঠিক করুন" button → preview
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
      .element(page.getByRole('button', { name: /run report/i }))
      .not.toBeInTheDocument()
  })

  it('shows the danger line and keeps Apply disabled until preview + backup + confirm', async () => {
    authState.permissions = ['run_stock_reconciliation']
    renderPage()
    // The old UI lives behind details (default closed).
    await userEvent.click(page.getByRole('button', { name: /বিস্তারিত দেখুন/i }))
    await expect.element(page.getByText(/Danger: Apply writes real stock/i)).toBeInTheDocument()

    // Run the dry-run report.
    await userEvent.click(page.getByRole('button', { name: /run report/i }))
    await expect.element(page.getByText('RTN-1')).toBeInTheDocument()
    await expect.element(page.getByText(/R1 missed restock: 1/i)).toBeInTheDocument()

    const applyBtn = page.getByRole('button', { name: /Apply 3 selected/i })
    await expect.element(applyBtn).toBeDisabled()

    // R1 row selectable (pre-checked); R4 row never selectable.
    const r1Checkbox = page.getByRole('checkbox', { name: /Select row R1/i })
    await expect.element(r1Checkbox).toBeChecked()
    const r4Checkbox = page.getByRole('checkbox', { name: /Select row R4/i })
    await expect.element(r4Checkbox).toBeDisabled()

    // R6 and evidence-backed R8 are applicable (2026-11-11 stock-mode
    // round); ambiguous R8-H stays report-only and shows as R8-H.
    const r6Checkbox = page.getByRole('checkbox', { name: /Select row R6/i })
    await expect.element(r6Checkbox).toBeChecked()
    const r8Checkbox = page.getByRole('checkbox', { name: /Select row R8\|o8/i })
    await expect.element(r8Checkbox).toBeChecked()
    const r8hCheckbox = page.getByRole('checkbox', { name: /Select row R8\|o9/i })
    await expect.element(r8hCheckbox).toBeDisabled()
    await expect.element(page.getByText('R8-H', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText(/R6 stranded managed: 1/i)).toBeInTheDocument()
    await expect.element(page.getByText(/R8 legacy returns: 1/i)).toBeInTheDocument()

    // Backup id alone is not enough — confirmation is also required.
    await userEvent.fill(page.getByLabelText(/Backup id/i), 'dump-42')
    await expect.element(applyBtn).toBeDisabled()
    await userEvent.click(page.getByText(/I reviewed the preview/i))
    await expect.element(applyBtn).not.toBeDisabled()

    await userEvent.click(applyBtn)
    await expect.element(page.getByText(/Apply result \(run run-1\)/i)).toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconcile/apply',
      { backupId: 'dump-42', rowIds: ['R1|r1|p1|v1|managed', 'R6|p6||managed', 'R8|o8||||managed'], confirmed: true },
      expect.anything(),
    )
  })

  it('hides check details until the row is expanded, keeping the 400-char collapse', async () => {
    authState.permissions = ['run_stock_reconciliation']
    renderPage()
    await userEvent.click(page.getByRole('button', { name: /বিস্তারিত দেখুন/i }))
    await userEvent.click(page.getByRole('button', { name: /run report/i }))
    await expect.element(page.getByText('RTN-1')).toBeInTheDocument()

    // Compact table: code + one-line label + count, detail hidden by default.
    await expect.element(page.getByText('Managed adds missing')).toBeInTheDocument()
    await expect.element(page.getByText('one row')).not.toBeInTheDocument()

    await userEvent.click(page.getByRole('button', { name: /Q1 details/i }))
    await expect.element(page.getByText('one row')).toBeInTheDocument()

    // Long Q8 detail collapses past 400 chars behind "Show full detail".
    await userEvent.click(page.getByRole('button', { name: /Q8 details/i }))
    await expect.element(page.getByRole('button', { name: /Show full detail/i })).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /Show full detail/i }))
    await expect.element(page.getByRole('button', { name: /Show less/i })).toBeInTheDocument()
  })

  it('hides the Q8 settle card from non-superadmins', async () => {
    authState.permissions = ['run_stock_reconciliation']
    authState.role = 'admin'
    renderPage()
    await userEvent.click(page.getByRole('button', { name: /বিস্তারিত দেখুন/i }))
    await expect
      .element(page.getByText(/Settle orphaned Q8 units/i))
      .not.toBeInTheDocument()
  })

  it('superadmin can preview then settle orphaned Q8 units', async () => {
    authState.permissions = ['run_stock_reconciliation']
    authState.role = 'superadmin'
    renderPage()
    await userEvent.click(page.getByRole('button', { name: /বিস্তারিত দেখুন/i }))
    await expect.element(page.getByText(/Settle orphaned Q8 units/i)).toBeInTheDocument()

    // Preview is a dry run — nothing is written.
    await userEvent.click(page.getByRole('button', { name: /^Preview$/i }))
    await expect.element(page.getByText(/Preview — nothing was written/i)).toBeInTheDocument()
    await expect.element(page.getByText(/Released units: 2/i)).toBeInTheDocument()
    await expect.element(page.getByText(/Flags cleared: 1/i)).toBeInTheDocument()
    await expect.element(page.getByText('LED-1')).toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconciliation/q8-settle',
      { dryRun: true },
      expect.anything(),
    )

    // Settle stays disabled until confirmed.
    const settleBtn = page.getByRole('button', { name: /^Settle$/i })
    await expect.element(settleBtn).toBeDisabled()
    await userEvent.click(page.getByText(/I understand settling writes ledger entries/i))
    await expect.element(settleBtn).not.toBeDisabled()

    await userEvent.click(settleBtn)
    await expect.element(page.getByText(/^Settled$/i)).toBeInTheDocument()
    await expect.element(page.getByText(/Remaining fails: 0/i)).toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconciliation/q8-settle',
      { dryRun: false },
      expect.anything(),
    )
  })

  it('details are closed by default and the banner is neutral before any check', async () => {
    authState.permissions = ['run_stock_reconciliation']
    renderPage()
    await expect.element(page.getByText(/এখনো যাচাই করা হয়নি/i)).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /স্টক যাচাই ও ঠিক করুন/i }))
      .toBeInTheDocument()
    // Old UI hidden until details are opened.
    await expect
      .element(page.getByRole('button', { name: /run report/i }))
      .not.toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /বিস্তারিত দেখুন/i }))
    await expect
      .element(page.getByRole('button', { name: /run report/i }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /বিস্তারিত লুকান/i }))
      .toBeInTheDocument()
  })

  it('one-click flow previews, confirms once and shows the fix-all result', async () => {
    authState.permissions = ['run_stock_reconciliation']
    authState.role = 'admin'
    renderPage()

    await userEvent.click(page.getByRole('button', { name: /স্টক যাচাই ও ঠিক করুন/i }))

    // Preview: plain Bengali lines, Bengali digits, no R/Q codes.
    await expect.element(page.getByText(/১টা মিস হওয়া restock যোগ হবে/i)).toBeInTheDocument()
    await expect
      .element(page.getByText(/১টা আটকে থাকা managed stock ছেড়ে দেওয়া হবে/i))
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/১টা পুরনো অর্ডারের Return রেকর্ড তৈরি হবে/i))
      .toBeInTheDocument()
    await expect.element(page.getByText(/২টা জিনিস নিজে দেখতে হবে/i)).toBeInTheDocument()
    // Non-superadmin: no Q8 settle line, and the q8-settle endpoint is
    // never called in the default flow.
    await expect
      .element(page.getByText(/আটকে থাকা reservation/i))
      .not.toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalledWith(
      '/inventory/reconciliation/q8-settle',
      expect.anything(),
      expect.anything(),
    )

    // Exactly one explicit confirm: disabled until the checkbox is ticked.
    const fixBtn = page.getByRole('button', { name: /^ঠিক করুন$/i })
    await expect.element(fixBtn).toBeDisabled()
    await userEvent.click(page.getByText(/আমি বুঝেছি/i))
    await expect.element(fixBtn).not.toBeDisabled()

    await userEvent.click(fixBtn)
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconcile/fix-all',
      { confirmed: true },
      expect.anything(),
    )

    // Result screen: applied/skipped, why settle was skipped, auto backup.
    await expect.element(page.getByText(/ঠিক করা হয়েছে/i)).toBeInTheDocument()
    await expect.element(page.getByText(/৩টা সারি ঠিক হয়েছে/i)).toBeInTheDocument()
    await expect.element(page.getByText(/১টা বাদ গেছে/i)).toBeInTheDocument()
    await expect.element(page.getByText('s1')).toBeInTheDocument()
    await expect.element(page.getByText(/no longer qualifies/i)).toBeInTheDocument()
    await expect
      .element(page.getByText(/Q8 settle হয়নি: Only superadmins can settle orphaned units\./i))
      .toBeInTheDocument()
    await expect.element(page.getByText('backup-auto-123')).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /কপি করুন/i }))
      .toBeInTheDocument()
    await expect.element(page.getByText(/আবার যাচাই: ঠিক আছে/i)).toBeInTheDocument()
    // Auto re-run dry-run refreshes the verdict banner (REPORT still has
    // 3 applicable rows + the failing Q1 check = ৪ problems).
    await expect.element(page.getByText(/৪টা সমস্যা পাওয়া গেছে/i)).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/inventory/reconcile').length).toBe(2)
  })

  it('one-click flow for superadmin includes the Q8 preview line and settle outcome', async () => {
    authState.permissions = ['run_stock_reconciliation']
    authState.role = 'superadmin'
    renderPage()

    await userEvent.click(page.getByRole('button', { name: /স্টক যাচাই ও ঠিক করুন/i }))
    await expect
      .element(page.getByText(/২টা আটকে থাকা reservation ছেড়ে দেওয়া হবে/i))
      .toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith(
      '/inventory/reconciliation/q8-settle',
      { dryRun: true },
      expect.anything(),
    )

    await userEvent.click(page.getByText(/আমি বুঝেছি/i))
    await userEvent.click(page.getByRole('button', { name: /^ঠিক করুন$/i }))
    await expect
      .element(page.getByText(/২ ইউনিট ছেড়ে দেওয়া হয়েছে, ১টা flag পরিষ্কার হয়েছে/i))
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

    await userEvent.click(page.getByRole('button', { name: /স্টক যাচাই ও ঠিক করুন/i }))
    await expect.element(page.getByText(/ঠিক করার মতো কিছু নেই/i)).toBeInTheDocument()
    await expect.element(page.getByText(/সব ঠিক আছে/i)).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^ঠিক করুন$/i }))
      .toBeDisabled()
  })

  it('fix-all error shows the backend message verbatim and states nothing was written', async () => {
    authState.permissions = ['run_stock_reconciliation']
    flowState.fixAllShouldFail = true
    renderPage()

    await userEvent.click(page.getByRole('button', { name: /স্টক যাচাই ও ঠিক করুন/i }))
    await expect.element(page.getByText(/১টা মিস হওয়া restock যোগ হবে/i)).toBeInTheDocument()
    await userEvent.click(page.getByText(/আমি বুঝেছি/i))
    await userEvent.click(page.getByRole('button', { name: /^ঠিক করুন$/i }))

    await expect.element(page.getByText(/Backup did not finish\./i)).toBeInTheDocument()
    await expect.element(page.getByText(/কিছু লেখা হয়নি/i)).toBeInTheDocument()
    await expect.element(page.getByText(/ঠিক করা হয়েছে/i)).not.toBeInTheDocument()
  })
})
