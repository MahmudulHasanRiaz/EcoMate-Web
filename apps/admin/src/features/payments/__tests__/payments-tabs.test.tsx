import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PaymentVerificationPage } from '../payment-verification'

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/payment-logo', () => ({
  PaymentLogo: ({ method }: any) => <span data-testid="pay-logo">{method}</span>,
}))

const paidRow = {
  id: 'pay-1',
  orderId: 'order-1',
  gatewayCode: 'bkash',
  amount: 800,
  status: 'PAID',
  transactionId: null,
  verifiedBy: null,
  verifiedAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  order: { displayId: 'ORD-001' },
  verifier: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PaymentVerificationPage />
    </QueryClientProvider>,
  )
}

describe('Payments page tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/payments') {
        return { data: { data: [paidRow], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } } }
      }
      return { data: [] }
    })
  })

  it('lists recorded payments (including staff-collected advances) with filters', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByRole('button', { name: 'All Payments' }))
    await expect.element(ui.getByText('ORD-001')).toBeInTheDocument()
    await expect.element(ui.getByText('PAID', { exact: true })).toBeInTheDocument()
  })

  it('keeps the verifying queue as the default tab', async () => {
    const ui = await renderPage()
    await expect.element(ui.getByText('Payment Verification')).not.toBeInTheDocument()
    // Default tab shows the verifying queue (empty here → empty-state copy).
    await expect.element(ui.getByText('No orders awaiting payment verification')).toBeInTheDocument()
  })
})
