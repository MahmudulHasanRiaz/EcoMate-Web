import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
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

  it('opens on the approval-first All Payments tab and lists recorded rows', async () => {
    const ui = await renderPage()
    // A: the default tab is All Payments — the ledger renders immediately,
    // no click needed, with its one-line hint.
    await expect.element(
      ui.getByText('Every recorded payment row — approvals, balances and gateway history.'),
    ).toBeInTheDocument()
    await expect.element(ui.getByText('ORD-001')).toBeInTheDocument()
    await expect.element(ui.getByText('PAID', { exact: true })).toBeInTheDocument()
  })

  it('does NOT open on the verify queue, and the header badge is the truthful pending count', async () => {
    const ui = await renderPage()
    // The verify queue (and its empty-state copy) is one click away, not the default.
    await expect.element(ui.getByText('No orders awaiting payment verification')).not.toBeInTheDocument()
    // Header badge = PENDING ledger rows (meta.total from the pendingCount query).
    await expect.element(ui.getByText('1 pending')).toBeInTheDocument()
  })
})
