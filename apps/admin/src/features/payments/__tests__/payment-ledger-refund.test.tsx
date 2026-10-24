import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PaymentVerificationPage } from '../payment-verification'

const mockGet = vi.hoisted(() => vi.fn())
const mockPut = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: mockPut, delete: vi.fn() },
}))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: any) => sel({ auth: { user: { id: 'u1' } } }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/payment-logo', () => ({
  PaymentLogo: ({ method }: any) => <span data-testid="pay-logo">{method}</span>,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const paidFull = {
  id: 'pay-full',
  orderId: 'order-1',
  gatewayCode: 'bkash',
  account: '017XX',
  amount: 1000,
  status: 'PAID',
  transactionId: 'TXFULL',
  recordedBy: 'staff:u2',
  submittedBy: 'staff:u2',
  recordedAt: '2026-02-01T10:00:00Z',
  createdAt: '2026-02-01T10:00:00Z',
  order: { displayId: 'ORD-001' },
  verifier: null,
  sourceRefunds: [],
}

const paidPartial = {
  ...paidFull,
  id: 'pay-partial',
  amount: 1000,
  transactionId: 'TXPART',
  // 700 already refunded (approved) → remainder 300.
  sourceRefunds: [{ id: 'ref-1', amount: 700, status: 'approved' }],
}

const paidRefunded = {
  ...paidFull,
  id: 'pay-refunded',
  amount: 1000,
  transactionId: 'TXDONE',
  sourceRefunds: [{ id: 'ref-2', amount: 1000, status: 'completed' }],
}

const pendingRow = {
  ...paidFull,
  id: 'pay-pending',
  status: 'PENDING',
  transactionId: 'TXPEND',
  sourceRefunds: [],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PaymentVerificationPage />
    </QueryClientProvider>,
  )
}

describe('Payment ledger — refund via selection (D-B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/payments') {
        return { data: { data: [paidFull, paidPartial, paidRefunded, pendingRow], meta: { total: 4, page: 1, perPage: 20, totalPages: 1 } } }
      }
      if (url === '/gateways/admin' || url === '/gateways/payment-form') {
        return {
          data: [{
            id: 'gw-bkash',
            code: 'bkash',
            name: 'bKash',
            type: 'manual',
            paymentOptionType: 'FULL_PAYMENT',
            paymentOptionName: 'Full Payment',
            paymentOptionEnabled: true,
            enabled: true,
            mode: 'personal',
            phoneNumber: '017XX',
            accountId: 'acc-bkash',
            account: { id: 'acc-bkash', code: '1001', name: 'bKash Wallet', type: 'asset' },
            credentials: {},
            sortOrder: 1,
          }],
        }
      }
      if (url === '/accounts/tree') {
        return {
          data: [{
            id: 'acc-bkash',
            code: '1001',
            name: 'bKash Wallet',
            type: 'asset',
            parentId: null,
            isActive: true,
            isGroup: false,
            children: [],
          }],
        }
      }
      return { data: [] }
    })
    mockPut.mockResolvedValue({ data: { id: 'x', status: 'PAID' } })
    mockPost.mockResolvedValue({ data: { id: 'refund-1' } })
  })

  it('searches by order number via the orderNumber param', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    await userEvent.fill(ui.getByLabelText('Search order number'), 'ORD-001')
    await userEvent.click(ui.getByRole('button', { name: /^Search$/ }))
    expect(mockGet).toHaveBeenCalledWith('/payments', expect.objectContaining({
      params: expect.objectContaining({ orderNumber: 'ORD-001' }),
    }))
  })

  it('selects PAID rows and refunds the summed remainder with sourcePaymentIds', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    // pay-full (remainder 1000) + pay-partial (remainder 300) → 1300.
    await userEvent.click(ui.getByLabelText('Select payment pay-full'))
    await userEvent.click(ui.getByLabelText('Select payment pay-partial'))
    await userEvent.click(ui.getByRole('button', { name: /Refund.*1300/ }))
    // Modal shows the source rows; the prefilled 1300 posts straight through.
    await expect.element(ui.getByText(/Refunding from 2 payment rows/)).toBeInTheDocument()
    await expect.element(ui.getByLabelText(/Gateway/)).toBeDisabled()
    // D7: no account picker anywhere — the refund destination derives
    // from the gateway's mapped account (asserted in the payload below).
    expect(ui.getByLabelText(/Account/).elements()).toHaveLength(0)
    await expect.element(ui.getByText(/Settles to bKash Wallet \(1001\)/)).toBeInTheDocument()
    await userEvent.fill(ui.getByLabelText(/Reason/), 'bulk return')
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    expect(mockPost).toHaveBeenCalledWith('/refunds', expect.objectContaining({
      orderId: 'order-1',
      amount: 1300,
      sourcePaymentIds: ['pay-full', 'pay-partial'],
      gatewayCode: 'bkash',
      accountId: 'acc-bkash',
    }))
  })

  it('disables selection for pending rows with the approve-first reason', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    await expect.element(ui.getByLabelText('Select payment pay-pending')).toBeDisabled()
    await expect.element(ui.getByText(/pending rows must be approved or failed first/i)).toBeInTheDocument()
  })

  it('shows a Refunded badge on fully-refunded source rows and blocks reselect', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    await expect.element(ui.getByText('Refunded').first()).toBeInTheDocument()
    await expect.element(ui.getByLabelText('Select payment pay-refunded')).toBeDisabled()
  })
})
