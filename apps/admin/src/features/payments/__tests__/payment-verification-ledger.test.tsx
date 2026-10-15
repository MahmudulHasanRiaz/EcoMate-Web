import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PaymentVerificationPage } from '../payment-verification'

const mockGet = vi.hoisted(() => vi.fn())
const mockPut = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: mockPut, delete: vi.fn() },
}))
// Current staff user is u1 — entries THEY recorded cannot be self-approved.
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

const pendingSelf = {
  id: 'pay-self',
  orderId: 'order-1',
  gatewayCode: 'bkash',
  account: '017XX',
  amount: 800,
  status: 'PENDING',
  transactionId: 'TXSELF',
  recordedBy: 'staff:u1',
  submittedBy: 'staff:u1',
  recordedAt: '2026-02-01T10:00:00Z',
  createdAt: '2026-02-01T10:00:00Z',
  order: { displayId: 'ORD-001' },
  verifier: null,
}

const pendingOther = {
  ...pendingSelf,
  id: 'pay-other',
  transactionId: 'TXOTHER',
  recordedBy: 'staff:u2',
  submittedBy: 'staff:u2',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PaymentVerificationPage />
    </QueryClientProvider>,
  )
}

describe('All-payments ledger (Task 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/payments') {
        return { data: { data: [pendingSelf, pendingOther], meta: { total: 2, page: 1, perPage: 20, totalPages: 1 } } }
      }
      return { data: [] }
    })
    mockPut.mockResolvedValue({ data: { id: 'pay-other', status: 'PAID' } })
  })

  it('shows account + transaction ID columns', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    await expect.element(ui.getByText('Account')).toBeInTheDocument()
    await expect.element(ui.getByText('Transaction ID')).toBeInTheDocument()
    await expect.element(ui.getByText('017XX').first()).toBeInTheDocument()
    await expect.element(ui.getByText('TXSELF')).toBeInTheDocument()
  })

  it('disables approve for self-recorded entries with a hint', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    await expect.element(ui.getByText(/another approver must verify/)).toBeInTheDocument()
    const approveBtns = ui.getByRole('button', { name: /^Approve$/ })
    await expect.element(approveBtns.first()).toBeDisabled()
  })

  it('approves another staff entry via the per-row verify endpoint', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    const approveBtns = ui.getByRole('button', { name: /^Approve$/ })
    await userEvent.click(approveBtns.nth(1))
    expect(mockPut).toHaveBeenCalledWith('/payments/pay-other/verify', expect.objectContaining({ status: 'PAID' }))
  })

  it('filters pending / verified via quick filters', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    await userEvent.click(ui.getByRole('button', { name: /^Pending$/ }))
    expect(mockGet).toHaveBeenCalledWith('/payments', expect.objectContaining({
      params: expect.objectContaining({ status: 'PENDING' }),
    }))
    await userEvent.click(ui.getByRole('button', { name: /^Verified$/ }))
    expect(mockGet).toHaveBeenCalledWith('/payments', expect.objectContaining({
      params: expect.objectContaining({ status: 'PAID' }),
    }))
  })
})
