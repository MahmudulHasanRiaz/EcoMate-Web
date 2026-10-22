import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecordRefundModal, REFUND_CANCEL_QUESTION } from './record-refund-modal'
import { useAuthStore } from '@/stores/auth-store'

const mockPost = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())
/** The effective payment settings the modal reads (the refund toggle). */
const paymentSettings = vi.hoisted(() => ({
  current: { staffAutoVerified: true, editAllowed: false, staffRefundsAllowed: true },
}))

const cashGateway = {
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
  account: { id: 'acc-cash', code: '1000', name: 'Cash', type: 'asset' },
  credentials: {},
  sortOrder: 1,
}
const bkashGateway = {
  ...cashGateway,
  id: 'gw-bkash',
  code: 'bkash',
  name: 'bKash',
  type: 'manual',
  phoneNumber: '01700000000',
  accountId: 'acc-bkash',
  account: { id: 'acc-bkash', code: '1001', name: 'bKash Wallet', type: 'asset' },
  sortOrder: 2,
}
const accounts = [
  { id: 'acc-cash', code: '1000', name: 'Cash', type: 'asset', parentId: null, isActive: true, isGroup: false, children: [] },
  { id: 'acc-bkash', code: '1001', name: 'bKash Wallet', type: 'asset', parentId: null, isActive: true, isGroup: false, children: [] },
]
const latestPaid = {
  id: 'pay-latest',
  orderId: 'order-1',
  gatewayCode: 'bkash',
  accountId: 'acc-bkash',
  amount: 2000,
  status: 'PAID',
  recordedAt: '2026-10-22T10:00:00.000Z',
  createdAt: '2026-10-22T10:00:00.000Z',
}

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    put: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderModal(props: Partial<Parameters<typeof RecordRefundModal>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RecordRefundModal orderId="order-1" open onClose={() => {}} {...props} />
    </QueryClientProvider>,
  )
}

describe('RecordRefundModal (Part 4: config-sourced destination)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: { id: 'refund-1' } })
    mockGet.mockImplementation((url: string) => {
      if (url === '/payments/settings') {
        return Promise.resolve({ data: { global: paymentSettings.current, gateways: [] } })
      }
      if (url === '/gateways/admin') {
        return Promise.resolve({ data: [cashGateway, bkashGateway] })
      }
      if (url === '/accounts/tree') {
        return Promise.resolve({ data: accounts })
      }
      if (url === '/payments') {
        return Promise.resolve({
          data: {
            data: [latestPaid],
            meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    paymentSettings.current = {
      staffAutoVerified: true,
      editAllowed: false,
      staffRefundsAllowed: true,
    }
    // A staff member with a normal order permission (User Management staff).
    useAuthStore.setState({
      auth: {
        user: {
          id: 'staff-1',
          email: 'staff@ecomate.com',
          role: 'employee',
          permissions: ['change_status_orders'],
        },
        accessToken: 'token',
      },
    } as never)
  })

  it('asks the cancel-too question verbatim with Yes/No options', async () => {
    const ui = await renderModal()
    await expect.element(ui.getByText(REFUND_CANCEL_QUESTION)).toBeInTheDocument()
    await expect.element(ui.getByText(/Yes, cancel it now/)).toBeInTheDocument()
    await expect.element(ui.getByText(/No, later/)).toBeInTheDocument()
  })

  it('preselects the latest verified payment gateway + mapped account', async () => {
    const ui = await renderModal()
    await expect.element(ui.getByLabelText('Gateway')).toHaveTextContent(/bKash/)
    await expect.element(ui.getByLabelText('Account')).toHaveTextContent(/bKash Wallet/)
    await userEvent.fill(ui.getByLabelText(/Amount/), '1200')
    await userEvent.fill(ui.getByLabelText(/Reason/), 'customer cancelled')
    await userEvent.click(ui.getByText(/Yes, cancel it now/))
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    expect(mockPost).toHaveBeenCalledWith('/refunds', expect.objectContaining({
      orderId: 'order-1',
      amount: 1200,
      method: 'bKash',
      gatewayCode: 'bkash',
      accountId: 'acc-bkash',
      reason: 'customer cancelled',
      cancelToo: true,
    }))
  })

  it('requires amount, configured gateway and reason (no typed destination)', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/payments/settings') {
        return Promise.resolve({ data: { global: paymentSettings.current, gateways: [] } })
      }
      if (url === '/gateways/admin') return Promise.resolve({ data: [] })
      if (url === '/accounts/tree') return Promise.resolve({ data: accounts })
      return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, perPage: 100, totalPages: 0 } } })
    })
    const ui = await renderModal()
    await userEvent.fill(ui.getByLabelText(/Amount/), '400')
    await userEvent.fill(ui.getByLabelText(/Reason/), 'partial adjustment')
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    expect(mockPost).not.toHaveBeenCalled()
    await expect.element(ui.getByText(/No payment gateway is enabled/)).toBeInTheDocument()
  })

  it('posts cancelToo=false when No is chosen (refund only)', async () => {
    const ui = await renderModal()
    await expect.element(ui.getByLabelText('Gateway')).toHaveTextContent(/bKash/)
    await userEvent.fill(ui.getByLabelText(/Amount/), '400')
    await userEvent.fill(ui.getByLabelText(/Reason/), 'partial adjustment')
    await userEvent.click(ui.getByText(/No, later/))
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    expect(mockPost).toHaveBeenCalledWith('/refunds', expect.objectContaining({ cancelToo: false }))
  })

  it('shows the explanation and blocks the refund when the staff refund toggle is OFF', async () => {
    paymentSettings.current = {
      staffAutoVerified: true,
      editAllowed: false,
      staffRefundsAllowed: false,
    }
    const ui = await renderModal()
    await expect
      .element(ui.getByText(/Refunds are restricted to administrators/))
      .toBeInTheDocument()
    // The cancel itself is never blocked by the refund gate — the explanation
    // says so, and no refund request is sent.
    await expect
      .element(ui.getByText(/You can still cancel the order without a refund record/))
      .toBeInTheDocument()
    await expect
      .element(ui.getByRole('button', { name: /^Record refund$/ }))
      .toBeDisabled()
  })

  it('keeps the refund available for an ADMIN even when the staff toggle is OFF', async () => {
    paymentSettings.current = {
      staffAutoVerified: true,
      editAllowed: false,
      staffRefundsAllowed: false,
    }
    useAuthStore.setState({
      auth: {
        user: {
          id: 'admin-1',
          email: 'admin@ecomate.com',
          role: 'admin',
          permissions: [],
        },
        accessToken: 'token',
      },
    } as never)
    const ui = await renderModal()
    await expect
      .element(ui.getByRole('button', { name: /^Record refund$/ }))
      .toBeEnabled()
  })

  it('prefills amount + source rows from payment-list selection (D-B)', async () => {
    const ui = await renderModal({
      initialAmount: 1300,
      sourcePaymentIds: ['pay-full', 'pay-partial'],
      sourceContext: [
        { id: 'pay-full', gatewayCode: 'cash', accountId: 'acc-cash', amount: 1000, remainder: 1000 },
        { id: 'pay-partial', gatewayCode: 'cash', accountId: 'acc-cash', amount: 1000, remainder: 300 },
      ],
    })
    await expect.element(ui.getByText(/Refunding from 2 payment rows/)).toBeInTheDocument()
    await expect.element(ui.getByLabelText('Gateway')).toHaveTextContent(/Cash/)
    await expect.element(ui.getByLabelText('Account')).toHaveTextContent(/Cash \(1000\)/)
    await userEvent.fill(ui.getByLabelText(/Reason/), 'bulk return')
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    // The prefilled 1300 (1000 + 300 remainders) posts straight through.
    expect(mockPost).toHaveBeenCalledWith('/refunds', expect.objectContaining({
      orderId: 'order-1',
      amount: 1300,
      method: 'Cash',
      gatewayCode: 'cash',
      accountId: 'acc-cash',
      sourcePaymentIds: ['pay-full', 'pay-partial'],
    }))
  })
})
