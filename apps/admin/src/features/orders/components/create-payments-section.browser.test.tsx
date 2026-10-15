import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { CreatePaymentsSection } from './create-payments-section'
import { emptyCollectedRow } from './create-payments-section'

describe('CreatePaymentsSection', () => {
  it('adds/removes rows and warns on overpayment (allowed, becomes credit)', async () => {
    const onRowsChange = vi.fn()
    const ui = await render(
      <CreatePaymentsSection
        rows={[{ ...emptyCollectedRow(), amount: '2500' }]}
        onRowsChange={onRowsChange}
        txnRequired
        total={2000}
        creditBalance={0}
        applyCredit={false}
        onApplyCreditChange={() => {}}
        creditAmount=""
        onCreditAmountChange={() => {}}
      />,
    )
    await expect.element(ui.getByText(/Overpayment ৳500.*becomes customer credit/)).toBeInTheDocument()
    await userEvent.click(ui.getByRole('button', { name: /Add payment row/ }))
    expect(onRowsChange).toHaveBeenCalledTimes(1)
    expect(onRowsChange.mock.calls[0][0]).toHaveLength(2)
  })

  it('offers apply-credit when the customer holds credit', async () => {
    const ui = await render(
      <CreatePaymentsSection
        rows={[emptyCollectedRow()]}
        onRowsChange={() => {}}
        txnRequired={false}
        total={2000}
        creditBalance={750}
        applyCredit={false}
        onApplyCreditChange={() => {}}
        creditAmount=""
        onCreditAmountChange={() => {}}
      />,
    )
    await expect.element(ui.getByText(/Apply credit ৳750/)).toBeInTheDocument()
  })

  it('marks txn required exactly when S1 is OFF', async () => {
    const ui = await render(
      <CreatePaymentsSection
        rows={[emptyCollectedRow()]}
        onRowsChange={() => {}}
        txnRequired
        total={2000}
        creditBalance={0}
        applyCredit={false}
        onApplyCreditChange={() => {}}
        creditAmount=""
        onCreditAmountChange={() => {}}
      />,
    )
    await expect.element(ui.getByText(/Transaction ID.*required/i).first()).toBeInTheDocument()
  })
})
