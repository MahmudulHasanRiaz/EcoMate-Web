import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LinkedReturnsSection } from './linked-returns-section'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const mockNavigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a onClick={() => mockNavigate()}>{children}</a>,
}))

const returnsRows = [
  { id: 'ret-1', displayId: 'RTN-261001-0001', orderId: 'order-1', type: 'PARTIAL', status: 'REQUESTED', source: 'STAFF', items: [], createdAt: '', updatedAt: '' },
  { id: 'ret-2', displayId: 'RTN-261001-0002', orderId: 'order-1', type: 'FULL', status: 'CLOSED', source: 'STAFF', items: [], createdAt: '', updatedAt: '' },
]
const readiness = {
  orderId: 'order-1',
  linked: true,
  exchanges: [{ id: 'ex-1', displayId: 'ORD-261001-0099', delivered: true }],
  returns: [],
  exchangeDelivered: true,
  returnArrived: false,
  canConfirmReturned: false,
  blockReason: null,
}

async function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LinkedReturnsSection orderId='order-1' />
    </QueryClientProvider>,
  )
}

describe('LinkedReturnsSection', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns') return Promise.resolve({ data: { data: returnsRows, meta: { total: 2, page: 1, limit: 100 } } })
      if (url.startsWith('/exchange/readiness/')) return Promise.resolve({ data: readiness })
      return Promise.resolve({ data: {} })
    })
  })

  it('lists RTN rows with type, status and link', async () => {
    const page = await renderSection()
    expect(page.getByText('Linked returns & exchanges', { exact: false })).not.toBeNull()
    expect(page.getByText('RTN-261001-0001', { exact: true })).not.toBeNull()
    expect(page.getByText('PARTIAL', { exact: true })).not.toBeNull()
    expect(page.getByText('REQUESTED', { exact: true })).not.toBeNull()
    // Closed history stays visible too.
    expect(page.getByText('RTN-261001-0002', { exact: true })).not.toBeNull()
  })

  it('lists linked exchanges with delivery state and link', async () => {
    const page = await renderSection()
    expect(page.getByText('ORD-261001-0099', { exact: true })).not.toBeNull()
    expect(page.getByText(/delivered/i)).not.toBeNull()
  })

  it('shows an empty state when nothing is linked', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns') return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 100 } } })
      if (url.startsWith('/exchange/readiness/')) {
        return Promise.resolve({ data: { ...readiness, linked: false, exchanges: [] } })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderSection()
    expect(page.getByText(/no linked returns or exchanges/i)).not.toBeNull()
  })
})
