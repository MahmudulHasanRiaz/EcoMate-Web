import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EarningsTable } from '../earnings-table'
import type { CommissionEarningRow } from '@/features/commissions/api'

vi.mock('@/features/commissions/api', () => ({
  commissionsApi: {
    listEarnings: vi.fn(),
    reverseEarning: vi.fn(),
  },
}))

vi.mock('@/features/employees/api', () => ({
  employeesApi: { list: vi.fn().mockResolvedValue({ data: [], meta: {} }) },
}))

import { commissionsApi } from '@/features/commissions/api'

const baseRow: CommissionEarningRow = {
  id: 'earn-1',
  employeeId: 'emp-1',
  ruleId: 'rule-1',
  orderId: 'order-1',
  amount: 1000,
  status: 'approved',
  createdAt: '2025-06-10T00:00:00.000Z',
  order: { id: 'order-1', displayId: 'ORD-1001' },
  rule: { id: 'rule-1', amountType: 'percent', amount: 5 },
  reversals: [],
}

async function renderTable(rows: CommissionEarningRow[], totals?: any) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  ;(commissionsApi.listEarnings as any).mockResolvedValue({
    // axios response shape — the hook unwraps `r.data` to the API envelope.
    data: {
      data: rows,
      meta: {
        total: rows.length,
        page: 1,
        perPage: 20,
        totalPages: 1,
        totals: totals ?? {
          totalCommission: 1000,
          totalReversed: 200,
          netPayable: 800,
        },
      },
    },
  })
  const result = await render(
    <QueryClientProvider client={queryClient}>
      <EarningsTable showEmployeeFilter={false} />
    </QueryClientProvider>,
  )
  // Let the async react-query fetch settle before assertions - the browser
  // auto-wait matchers can race the first query frame otherwise.
  await new Promise((r) => setTimeout(r, 100))
  return result
}

describe('EarningsTable', () => {
  it('renders rows with order display id and rule label', async () => {
    const { getByText, getByRole } = await renderTable([baseRow])

    await expect.element(getByText('ORD-1001')).toBeInTheDocument()
    await expect.element(getByText('5%')).toBeInTheDocument()
    await expect
      .element(getByRole('cell', { name: /1,000 ৳/ }))
      .toBeInTheDocument()
  })

  it('renders a Reversed badge and the In Payroll badge', async () => {
    const { getByText, getByTitle } = await renderTable([
      {
        ...baseRow,
        id: 'earn-rev',
        reversals: [
          { id: 'rev-1', amount: 1000, reason: 'Order cancelled', reversedAt: '2025-06-11T00:00:00.000Z' },
        ],
      },
      { ...baseRow, id: 'earn-pay', payslipId: 'ps-1' },
    ])

    await expect.element(getByText('Reversed', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('In Payroll', { exact: true })).toBeInTheDocument()
    await expect.element(getByTitle('Reversed: Order cancelled')).toBeInTheDocument()
  })

  it('renders the totals strip with net payable', async () => {
    const { getByText } = await renderTable([baseRow])

    await expect.element(getByText(/Reversed 200 ৳/i)).toBeInTheDocument()
    await expect.element(getByText(/Net payable 800 ৳/i)).toBeInTheDocument()
  })

  it('shows the reverse action only for non-reversed earnings', async () => {
    const { getByRole } = await renderTable([
      baseRow,
      {
        ...baseRow,
        id: 'earn-rev',
        reversals: [{ id: 'r1', amount: 1000, reason: 'cancelled' }],
      },
    ])

    await expect
      .element(getByRole('button', { name: /Reverse/ }).first())
      .toBeInTheDocument()
  })

  it('opens the reverse dialog (reason required) and submits', async () => {
    const { getByRole, getByLabelText } = await renderTable([baseRow])

    await userEvent.click(getByRole('button', { name: 'Reverse' }))
    await expect
      .element(getByRole('heading', { name: 'Reverse Commission' }))
      .toBeInTheDocument()

    await userEvent.fill(getByLabelText('Reversal reason'), 'Order cancelled')
    await userEvent.click(getByRole('button', { name: 'Reverse', exact: true }))

    expect(commissionsApi.reverseEarning as any).toHaveBeenCalledWith('earn-1', {
      reason: 'Order cancelled',
      refundedAmount: undefined,
    })
  })

  it('shows an empty state when there are no earnings', async () => {
    const { getByText } = await renderTable([])
    await expect
      .element(getByText(/No commission earnings to show/))
      .toBeInTheDocument()
  })
})
