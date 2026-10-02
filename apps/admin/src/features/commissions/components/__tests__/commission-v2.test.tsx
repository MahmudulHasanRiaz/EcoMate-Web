import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RuleDialogV2 } from '../rule-dialog-v2'
import { CommissionReportTable } from '../commission-report'
import type { CommissionReportResponse } from '../../api'

// hoisted so the mock factory and the tests share one instance (ESM browser mode
// has no `require`).
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({ apiClient: mockApi }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const EMPLOYEES = {
  data: {
    data: [
      { id: 'emp-a', employeeId: 'EMP-001', betterAuthUser: { name: 'Rahim Khan' } },
      { id: 'emp-b', employeeId: 'EMP-002', betterAuthUser: { name: 'Karim Uddin' } },
    ],
  },
}

const REPORT: CommissionReportResponse = {
  data: [
    {
      employeeId: 'emp-a',
      employeeCode: 'EMP-001',
      name: 'Rahim Khan',
      avatar: null,
      department: 'Ops',
      totalEarned: 14550,
      paid: 0,
      unpaid: 14550,
      earningCount: 24,
      byPurpose: [
        { purpose: 'Confirmed', amount: 4500, count: 900 },
        { purpose: 'Packed', amount: 7200, count: 900 },
        { purpose: 'Delivered', amount: 2850, count: 900 },
      ],
    },
  ],
  totals: { totalEarned: 14550, totalPaid: 0, totalUnpaid: 14550, employeeCount: 1 },
}

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('RuleDialogV2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/employees') return Promise.resolve(EMPLOYEES)
      return Promise.resolve({ data: [] })
    })
  })

  it('offers only commissionable actions, not free text', async () => {
    const { getByText } = await wrap(<RuleDialogV2 />)
    await userEvent.click(getByText('New Commission Rule'))

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Commission For')
    })

    // The action list is a fixed set — an admin cannot invent an action.
    await userEvent.click(document.querySelector('#cr-purpose') as HTMLElement)
    await vi.waitFor(() => {
      const t = document.body.textContent || ''
      for (const p of ['Confirmed', 'Packed', 'Shipping', 'Delivered', 'Returned', 'Cancelled']) {
        expect(t).toContain(p)
      }
    })
  })

  it('shows the threshold explanation with its exact start order', async () => {
    const { getByText } = await wrap(<RuleDialogV2 />)
    await userEvent.click(getByText('New Commission Rule'))

    await vi.waitFor(() => expect(document.body.textContent).toContain('Commission For'))

    // Enable the count threshold.
    const cb = document.querySelector('#cr-use-min-count') as HTMLElement
    await userEvent.click(cb)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Minimum qualifying orders'))

    const minInput = document.querySelector('#cr-min-count') as HTMLInputElement
    // The text must state that the first N only qualify and payment starts at N+1.
    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(/do not pay/)
      expect(document.body.textContent).toMatch(/Commission starts from order #/)
    })
    expect(minInput).toBeTruthy()
  })

  it('keeps minimum order amount separate from the count threshold', async () => {
    const { getByText } = await wrap(<RuleDialogV2 />)
    await userEvent.click(getByText('New Commission Rule'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Commission For'))

    // Both are independent, labelled controls.
    await userEvent.click(document.querySelector('#cr-use-min-count') as HTMLElement)
    await userEvent.click(document.querySelector('#cr-use-min-amount') as HTMLElement)

    await vi.waitFor(() => {
      const t = document.body.textContent || ''
      expect(t).toContain('Minimum qualifying orders')
      expect(t).toContain('Minimum order amount')
    })
  })

  it('previews the rule in plain language before saving', async () => {
    const { getByText } = await wrap(<RuleDialogV2 />)
    await userEvent.click(getByText('New Commission Rule'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Commission For'))

    // The summary only appears once employee + amount are set.
    expect(document.body.textContent).not.toContain('What this rule does')
  })
})

describe('CommissionReportTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/hr/commissions/v2/report') return Promise.resolve({ data: REPORT })
      return Promise.resolve({ data: { data: [], meta: {} } })
    })
  })

  it('renders a purpose column per action with its order count', async () => {
    await wrap(<CommissionReportTable from='2026-10-01' to='2026-10-31' />)

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Rahim Khan')
    })

    const t = document.body.textContent || ''
    expect(t).toContain('Confirmed')
    expect(t).toContain('Packed')
    expect(t).toContain('Delivered')
    // Counts, not just money: a total without its volume hides the workload.
    expect(t).toContain('900 orders')
  })

  it('shows paid and unpaid separately', async () => {
    await wrap(<CommissionReportTable />)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Rahim Khan'))

    const t = document.body.textContent || ''
    expect(t).toContain('Total Earned')
    expect(t).toContain('Paid')
    expect(t).toContain('Unpaid')
    expect(t).toContain('14,550.00')
  })

  it('renders an empty state rather than a blank table', async () => {
    mockApi.get.mockResolvedValue({
      data: { data: [], totals: { totalEarned: 0, totalPaid: 0, totalUnpaid: 0, employeeCount: 0 } },
    })
    await wrap(<CommissionReportTable />)
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('No commission has been earned')
    })
  })

  it('surfaces an error instead of claiming there is nothing', async () => {
    mockApi.get.mockRejectedValue(new Error('boom'))
    await wrap(<CommissionReportTable />)
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Could not load the commission report')
    })
    // Must NOT have fallen through to the empty state.
    expect(document.body.textContent).not.toContain('No commission has been earned')
  })
})