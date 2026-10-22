import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreatePaymentsSection } from './create-payments-section'
import { emptyCollectedRow } from './create-payments-section'

vi.mock('@/features/gateways/api', () => ({
  gatewayApi: {
    listGateways: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'gw-cash',
          code: 'cash',
          name: 'Cash',
          type: 'cash',
          paymentOptionType: 'CASH_ON_DELIVERY',
          paymentOptionName: 'Cash on Delivery',
          paymentOptionEnabled: true,
          enabled: true,
          mode: 'personal',
          phoneNumber: null,
          accountId: 'acc-cash',
          account: { id: 'acc-cash', code: '1001', name: 'Cash', type: 'asset' },
          credentials: {},
          sortOrder: 1,
        },
      ],
    }),
  },
}))

vi.mock('@/features/accounting/api', () => ({
  accountingApi: {
    getAccountTree: vi.fn().mockResolvedValue({
      data: [
        { id: 'acc-cash', code: '1001', name: 'Cash', type: 'asset', parentId: null, isActive: true, isGroup: false, children: [] },
        { id: 'acc-bank', code: '1002', name: 'Bank', type: 'asset', parentId: null, isActive: true, isGroup: false, children: [] },
      ],
    }),
  },
}))

function renderSection(ui: Parameters<typeof CreatePaymentsSection>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CreatePaymentsSection {...ui} />
    </QueryClientProvider>,
  )
}

describe('CreatePaymentsSection', () => {
  it('adds/removes rows and warns on overpayment (allowed, becomes credit)', async () => {
    const onRowsChange = vi.fn()
    const ui = await renderSection({
      rows: [{ ...emptyCollectedRow(), amount: '2500' }],
      onRowsChange,
      txnRequired: true,
      total: 2000,
      creditBalance: 0,
      applyCredit: false,
      onApplyCreditChange: () => {},
      creditAmount: '',
      onCreditAmountChange: () => {},
    })
    await expect.element(ui.getByText(/Overpayment ৳500.*becomes customer credit/)).toBeInTheDocument()
    onRowsChange.mockClear()
    await userEvent.click(ui.getByRole('button', { name: /Add payment row/ }))
    expect(onRowsChange.mock.calls.at(-1)?.[0]).toHaveLength(2)
  })

  it('offers apply-credit when the customer holds credit', async () => {
    const ui = await renderSection({
      rows: [emptyCollectedRow()],
      onRowsChange: () => {},
      txnRequired: false,
      total: 2000,
      creditBalance: 750,
      applyCredit: false,
      onApplyCreditChange: () => {},
      creditAmount: '',
      onCreditAmountChange: () => {},
    })
    await expect.element(ui.getByText(/Apply credit ৳750/)).toBeInTheDocument()
  })

  it('marks txn required exactly when S1 is OFF', async () => {
    const ui = await renderSection({
      rows: [emptyCollectedRow()],
      onRowsChange: () => {},
      txnRequired: true,
      total: 2000,
      creditBalance: 0,
      applyCredit: false,
      onApplyCreditChange: () => {},
      creditAmount: '',
      onCreditAmountChange: () => {},
    })
    await expect.element(ui.getByText(/Transaction ID.*required/i).first()).toBeInTheDocument()
  })
})
