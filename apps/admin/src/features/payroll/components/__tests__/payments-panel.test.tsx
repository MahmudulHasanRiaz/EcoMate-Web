import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PaymentsForPayslip } from '../payments-panel'
import type { PayslipResponse, PayrollPayment } from '@/features/payroll/api'

vi.mock('@/features/payroll/api', () => ({
  payrollApi: {
    listPayments: vi.fn(),
    createPayment: vi.fn(),
    voidPayment: vi.fn(),
  },
}))

import { payrollApi } from '@/features/payroll/api'

const livePayment: PayrollPayment = {
  id: 'pay-1',
  payslipId: 'ps-1',
  amount: 20000,
  paidAt: '2025-06-15T00:00:00.000Z',
  method: 'Cash',
  referenceNo: 'ch-1',
  note: null,
  voidedAt: null,
  voidedById: null,
  voidReason: null,
}

const voidedPayment: PayrollPayment = {
  ...livePayment,
  id: 'pay-2',
  amount: 5000,
  voidedAt: '2025-06-16T00:00:00.000Z',
  voidedById: 'actor-1',
  voidReason: 'Duplicate entry',
}

const payslip: PayslipResponse = {
  id: 'ps-1',
  employeeId: 'emp-1',
  periodStart: '2025-06-01T00:00:00.000Z',
  periodEnd: '2025-06-30T00:00:00.000Z',
  totalEarnings: 50000,
  totalDeductions: 3000,
  netPay: 47000,
  status: 'partially_paid',
  generatedAt: '2025-07-01T00:00:00.000Z',
  paidAt: null,
  reviewedAt: null,
  approvedAt: '2025-07-02T00:00:00.000Z',
  periodKey: '2025-06',
  notes: null,
}

function renderPanel(payments: PayrollPayment[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  ;(payrollApi.listPayments as any).mockResolvedValue({
    // axios response shape — the hook unwraps `r.data` to the payment array.
    data: payments,
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsForPayslip employeeId='emp-1' payslip={payslip} />
    </QueryClientProvider>,
  )
}

describe('PaymentsForPayslip — void flow (G-20)', () => {
  it('excludes voided payments from the paid total', async () => {
    const { getByText } = await renderPanel([livePayment, voidedPayment])

    // 20000 of 47000 — the voided 5000 must not count.
    await expect.element(getByText(/20,000 ৳ of 47,000 ৳/)).toBeInTheDocument()
  })

  it('shows a Voided badge with the void reason', async () => {
    const { getByText } = await renderPanel([livePayment, voidedPayment])

    await expect.element(getByText('Voided', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Duplicate entry')).toBeInTheDocument()
  })

  it('opens the void dialog, requires a reason, and calls voidPayment with it', async () => {
    const { getByRole, getByLabelText } = await renderPanel([livePayment])

    await userEvent.click(getByRole('button', { name: 'Void payment' }))
    await expect
      .element(getByRole('heading', { name: 'Void Payment' }))
      .toBeInTheDocument()

    const confirm = getByRole('button', { name: 'Void Payment', exact: true })
    expect((confirm.element() as HTMLButtonElement).disabled).toBe(true)

    await userEvent.fill(getByLabelText('Void reason'), 'Duplicate entry')
    await userEvent.click(confirm)

    expect(payrollApi.voidPayment as any).toHaveBeenCalledWith(
      'ps-1',
      'pay-1',
      'Duplicate entry',
    )
  })

  it('hides the void action for an already-voided payment', async () => {
    const { getByRole, getByText } = await renderPanel([voidedPayment])

    await expect.element(getByText('Voided', { exact: true })).toBeInTheDocument()
    const buttons = await getByRole('button', { name: 'Void payment' }).all()
    expect(buttons.length).toBe(0)
  })
})
