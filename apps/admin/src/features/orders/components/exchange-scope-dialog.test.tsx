import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExchangeScopeDialog } from './exchange-scope-dialog'

const mockNavigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const baseOrder = {
  id: 'order-1',
  displayId: 'ORD-261101-0001',
  payments: [{ status: 'PAID', amount: 300 }],
}

async function renderDialog(orderOverride: any) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onClose = vi.fn()
  const page = await render(
    <QueryClientProvider client={client}>
      <ExchangeScopeDialog order={orderOverride} open onClose={onClose} />
    </QueryClientProvider>,
  )
  return { ...page, onClose }
}

describe('ExchangeScopeDialog — Full/Partial chooser gate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  it('skips the chooser for a single-item, quantity-1 order and goes straight to the Full exchange page', async () => {
    const order = {
      ...baseOrder,
      items: [{ id: 'oi-1', productId: 'p1', quantity: 1, price: 300 }],
    }
    const { container, onClose } = await renderDialog(order)

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/op/orders/$id/exchange',
      params: { id: 'order-1' },
    })
    expect(onClose).toHaveBeenCalled()
    expect(container.textContent).not.toContain('Partial exchange')
  })

  it('offers both Full and Partial when the order has two single-quantity lines', async () => {
    const order = {
      ...baseOrder,
      items: [
        { id: 'oi-1', productId: 'p1', quantity: 1, price: 300 },
        { id: 'oi-2', productId: 'p2', quantity: 1, price: 500 },
      ],
    }
    await renderDialog(order)

    expect(mockNavigate).not.toHaveBeenCalled()
    // The dialog renders in a portal — assert against the document body.
    expect(document.body.textContent).toContain('Full exchange')
    expect(document.body.textContent).toContain('Partial exchange')
  })

  it('offers Partial when a single line has quantity 2 (a subset can come back)', async () => {
    const order = {
      ...baseOrder,
      items: [{ id: 'oi-1', productId: 'p1', quantity: 2, price: 300 }],
    }
    await renderDialog(order)

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Partial exchange')
  })
})
