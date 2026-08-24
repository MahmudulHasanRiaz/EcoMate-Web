import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { PayrollSummaryBar } from '../payroll-summary-bar'
import type { PayslipListSummary } from '../../api'

const summary: PayslipListSummary = {
  employeeCount: 12,
  totalEarnings: 500000,
  totalDeductions: 60000,
  totalCommission: 45000,
  netPay: 440000,
  totalPaid: 300000,
  outstanding: 140000,
}

describe('PayrollSummaryBar', () => {
  it('renders all seven summary stats with tabular numbers', async () => {
    const { getByText } = await render(<PayrollSummaryBar summary={summary} />)

    await expect.element(getByText('Employees')).toBeInTheDocument()
    await expect.element(getByText('12', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Gross Earnings')).toBeInTheDocument()
    await expect.element(getByText('500,000 ৳')).toBeInTheDocument()
    await expect.element(getByText('Commission')).toBeInTheDocument()
    await expect.element(getByText('45,000 ৳')).toBeInTheDocument()
    await expect.element(getByText('Deductions')).toBeInTheDocument()
    await expect.element(getByText('60,000 ৳')).toBeInTheDocument()
    await expect.element(getByText('Net Pay')).toBeInTheDocument()
    await expect.element(getByText('440,000 ৳')).toBeInTheDocument()
    await expect.element(getByText('Paid')).toBeInTheDocument()
    await expect.element(getByText('300,000 ৳')).toBeInTheDocument()
    await expect.element(getByText('Outstanding')).toBeInTheDocument()
    await expect.element(getByText('140,000 ৳')).toBeInTheDocument()
  })

  it('renders nothing when there is no summary', async () => {
    const { container } = await render(<PayrollSummaryBar summary={null} />)
    expect(container.childElementCount).toBe(0)
  })
})
