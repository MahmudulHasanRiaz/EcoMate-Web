import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SalaryHistoryCard } from '../salary-history'
import type { SalaryStructureResponse } from '../../api'

const openStructure: SalaryStructureResponse = {
  id: 'ss-2',
  employeeId: 'emp-1',
  basicSalary: 50000,
  houseAllowance: 0,
  medicalAllowance: 0,
  transportAllowance: 0,
  otherAllowance: 0,
  taxDeduction: 0,
  insuranceDeduction: 0,
  otherDeduction: 0,
  totalEarnings: 50000,
  totalDeductions: 0,
  netSalary: 50000,
  effectiveFrom: '2025-06-01T00:00:00.000Z',
  effectiveTo: null,
  isActive: true,
}

const closedStructure: SalaryStructureResponse = {
  ...openStructure,
  id: 'ss-1',
  netSalary: 40000,
  effectiveFrom: '2024-01-01T00:00:00.000Z',
  effectiveTo: '2025-05-31T00:00:00.000Z',
  isActive: false,
}

describe('SalaryHistoryCard', () => {
  it('renders open and closed structure windows', async () => {
    const { getByText } = await render(
      <SalaryHistoryCard
        structures={[openStructure, closedStructure]}
        mirrorSalary={50000}
      />
    )

    await expect
      .element(getByText('Jun 1, 2025 – Present'))
      .toBeInTheDocument()
    await expect
      .element(getByText('Jan 1, 2024 – May 31, 2025'))
      .toBeInTheDocument()
    await expect.element(getByText('Net: 50,000 ৳', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Net: 40,000 ৳', { exact: true })).toBeInTheDocument()
  })

  it('marks the active structure with an Active badge', async () => {
    const { getByText } = await render(
      <SalaryHistoryCard structures={[openStructure, closedStructure]} />
    )

    await expect.element(getByText('Active', { exact: true })).toBeInTheDocument()
    expect((await getByText('Active', { exact: true }).all()).length).toBe(1)
  })

  it('renders the summary line from getPayrollSummary data', async () => {
    const { getByText } = await render(
      <SalaryHistoryCard
        structures={[openStructure]}
        mirrorSalary={50000}
        summary={{
          currentStructure: openStructure,
          mirrorSalary: 50000,
          structures: [openStructure],
          payslips: [
            { id: 'ps-1', periodKey: '2025-06', netPay: 50000, status: 'paid' },
            { id: 'ps-2', periodKey: '2025-05', netPay: 50000, status: 'paid' },
          ],
          totalPaid: 90000,
          outstanding: 10000,
        }}
      />
    )

    await expect
      .element(getByText(/2 recent payslips/i))
      .toBeInTheDocument()
    await expect
      .element(getByText(/90,000 ৳ paid/i))
      .toBeInTheDocument()
    await expect
      .element(getByText(/10,000 ৳ outstanding/i))
      .toBeInTheDocument()
  })

  it('shows an empty state without structures', async () => {
    const { getByText } = await render(<SalaryHistoryCard structures={[]} />)
    await expect
      .element(getByText(/No salary history yet/i))
      .toBeInTheDocument()
  })
})