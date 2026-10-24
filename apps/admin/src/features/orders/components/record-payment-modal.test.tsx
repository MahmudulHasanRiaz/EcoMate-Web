import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecordPaymentModal } from './record-payment-modal'

const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: mockPost, put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/gateways/api', () => ({
  gatewayApi: {
    listPaymentFormGateways: vi.fn().mockResolvedValue({
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
      ],
    }),
  },
}))

function renderModal(txnRequired: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RecordPaymentModal orderId="order-1" open txnRequired={txnRequired} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('RecordPaymentModal (D1: stays SIMPLE)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: { id: 'pay-new' } })
  })

  it('requires amount + txn when S1 is OFF and records nothing on empty submit', async () => {
    const ui = await renderModal(true)
    await expect.element(ui.getByText(/Transaction ID.*required/i)).toBeInTheDocument()
    // Empty submit records nothing.
    await userEvent.click(ui.getByRole('button', { name: /^Record payment$/ }))
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('auto-selects the single configured gateway + mapped account and posts them', async () => {
    let resolvePost!: (v: unknown) => void
    mockPost.mockImplementation(() => new Promise((r) => { resolvePost = r }))
    const ui = await renderModal(true)
    await userEvent.fill(ui.getByLabelText(/Amount/), '1500')
    await userEvent.fill(ui.getByLabelText(/Transaction ID/), 'TX1')
    const submit = ui.getByRole('button', { name: /^Record payment$/ })
    await userEvent.click(submit)
    // While pending the submit stays disabled — no double-record.
    await expect.element(submit).toBeDisabled()
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith('/payments/order-1', expect.objectContaining({
      gatewayCode: 'cash',
      amount: 1500,
      accountId: 'acc-cash',
      transactionId: 'TX1',
    }))
    resolvePost({ data: { id: 'pay-new' } })
  })

  it('txn is optional when S1 is ON (staff auto-verified)', async () => {
    const ui = await renderModal(false)
    await expect.element(ui.getByText(/Transaction ID.*optional/i)).toBeInTheDocument()
    await userEvent.fill(ui.getByLabelText(/Amount/), '500')
    await userEvent.click(ui.getByRole('button', { name: /^Record payment$/ }))
    expect(mockPost).toHaveBeenCalledWith('/payments/order-1', expect.objectContaining({ amount: 500 }))
  })
})
