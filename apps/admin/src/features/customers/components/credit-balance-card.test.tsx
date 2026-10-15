import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreditBalanceCard } from './credit-balance-card'

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CreditBalanceCard customerId="cust-1" />
    </QueryClientProvider>,
  )
}

describe('CreditBalanceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a prominent balance plus the mini-ledger with source and date', async () => {
    mockGet.mockResolvedValue({
      data: {
        balance: 350,
        entries: [
          { id: 'e1', customerId: 'cust-1', orderId: 'order-9', paymentId: 'pay-9', amount: 500, reason: 'overpayment:order-9', createdAt: '2026-03-01T10:00:00Z' },
          { id: 'e2', customerId: 'cust-1', orderId: 'order-7', paymentId: 'pay-7', amount: -150, reason: 'applied:order-7', createdAt: '2026-03-02T10:00:00Z' },
        ],
      },
    })
    const ui = await renderCard()
    await expect.element(ui.getByText('৳350')).toBeInTheDocument()
    await expect.element(ui.getByText('+৳500')).toBeInTheDocument()
    await expect.element(ui.getByText('-৳150')).toBeInTheDocument()
    await expect.element(ui.getByText(/overpayment/)).toBeInTheDocument()
    await expect.element(ui.getByText(/ORD|order-9/)).toBeInTheDocument()
  })

  it('shows an empty state when the balance is zero', async () => {
    mockGet.mockResolvedValue({ data: { balance: 0, entries: [] } })
    const ui = await renderCard()
    await expect.element(ui.getByText(/No credit yet/)).toBeInTheDocument()
    await expect.element(ui.getByText('৳0')).toBeInTheDocument()
  })
})
