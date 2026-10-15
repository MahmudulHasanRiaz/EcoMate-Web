import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { PaymentLedgerCard } from './payment-ledger-card'

const rows = [
  {
    id: 'p1', amount: 1500, status: 'PAID', gatewayCode: 'bkash', account: '017XX',
    transactionId: 'TX1', recordedAt: '2026-02-01T10:00:00Z', createdAt: '2026-02-01T10:00:00Z',
    recordedBy: 'staff:u1', verifiedBy: 'u2', verifiedAt: '2026-02-01T11:00:00Z', notes: 'advance',
  },
  {
    id: 'p2', amount: -400, status: 'PAID', gatewayCode: 'bkash', account: '017XX',
    transactionId: null, recordedAt: '2026-02-02T10:00:00Z', createdAt: '2026-02-02T10:00:00Z',
    recordedBy: 'staff:u1', notes: 'partial refund',
  },
  {
    id: 'p3', amount: 200, status: 'PENDING', gatewayCode: 'nagad', account: '018YY',
    transactionId: 'TX9', recordedAt: null, createdAt: '2026-02-03T10:00:00Z',
    recordedBy: null, submittedBy: 'customer:c1', notes: null,
  },
]

describe('PaymentLedgerCard', () => {
  it('renders signed amounts, gateway/account, txn, verified/pending badges, actor and note', async () => {
    const ui = await render(
      <PaymentLedgerCard payments={rows} onRecordPayment={() => {}} onRecordRefund={() => {}} />,
    )
    await expect.element(ui.getByText('+৳1,500')).toBeInTheDocument()
    await expect.element(ui.getByText('-৳400')).toBeInTheDocument()
    await expect.element(ui.getByText('bkash').first()).toBeInTheDocument()
    await expect.element(ui.getByText('017XX').first()).toBeInTheDocument()
    await expect.element(ui.getByText('TX1')).toBeInTheDocument()
    await expect.element(ui.getByText('verified').first()).toBeInTheDocument()
    await expect.element(ui.getByText('pending')).toBeInTheDocument()
    await expect.element(ui.getByText('staff u1').first()).toBeInTheDocument()
    await expect.element(ui.getByText('partial refund')).toBeInTheDocument()
  })

  it('shows an empty state with no edit affordances for listed payments', async () => {
    const ui = await render(
      <PaymentLedgerCard payments={[]} onRecordPayment={() => {}} onRecordRefund={() => {}} />,
    )
    await expect.element(ui.getByText(/No payments recorded/)).toBeInTheDocument()
    // Corrections go through new entries (refund modal / staff note) — never
    // an in-place edit control on a listed row.
    await expect.element(ui.getByText(/Edit/)).not.toBeInTheDocument()
  })

  it('opens the record-payment and record-refund entries', async () => {
    const onPay = vi.fn()
    const onRefund = vi.fn()
    const ui = await render(
      <PaymentLedgerCard payments={rows} onRecordPayment={onPay} onRecordRefund={onRefund} />,
    )
    await userEvent.click(ui.getByRole('button', { name: /Record payment/ }))
    await userEvent.click(ui.getByRole('button', { name: /Record refund/ }))
    expect(onPay).toHaveBeenCalledTimes(1)
    expect(onRefund).toHaveBeenCalledTimes(1)
  })
})
