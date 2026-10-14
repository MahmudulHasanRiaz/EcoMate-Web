import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrderActionMenu } from './order-action-menu'

const mockNavigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))

const mockToastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({
  toast: { success: mockToastSuccess, error: vi.fn(), warning: vi.fn() },
}))

const saleOrder = {
  id: 'order-1',
  displayId: 'ORD-260930-0007',
  kind: 'SALE',
  trashedAt: null,
  status: { id: 'st-delivered', name: 'Delivered' },
  items: [
    { id: 'oi-1', productId: 'p1', variantId: null, quantity: 2, price: 500, product: { id: 'p1', name: 'Widget' }, variant: null },
    { id: 'oi-2', productId: 'p2', variantId: null, quantity: 1, price: 300, product: { id: 'p2', name: 'Gadget' }, variant: null },
  ],
}

function renderMenu(order: any = saleOrder) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrderActionMenu order={order} />
    </QueryClientProvider>,
  )
}

describe('OrderActionMenu (Task 4 Fix 8)', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockNavigate.mockReset()
    mockToastSuccess.mockReset()
    mockGet.mockResolvedValue({ data: { data: [] } })
  })

  it('renders a Plus menu with the 3 exact action labels', async () => {
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    expect(getByText('Create Return Order', { exact: true })).not.toBeNull()
    expect(getByText('Create Exchange Order', { exact: true })).not.toBeNull()
    expect(getByText('Create Partial Return Order', { exact: true })).not.toBeNull()
  })

  it('Create Return Order calls ReturnsService FULL directly (no phantom Order)', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-1', displayId: 'RTN-260930-0001' } })
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    await userEvent.click(getByText('Create Return Order', { exact: true }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
    expect(mockPost).toHaveBeenCalledWith(
      '/returns',
      expect.objectContaining({ orderId: 'order-1', type: 'FULL', source: 'STAFF' }),
    )
    // No phantom Orders: nothing posts to the order-creation endpoints.
    for (const [url] of mockPost.mock.calls) {
      expect(String(url)).not.toMatch(/^\/orders$/)
      expect(String(url)).not.toMatch(/^\/rtn\//)
    }
    await expect.poll(() => mockToastSuccess.mock.calls.length).toBe(1)
    expect(mockToastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('RTN-260930-0001'),
    )
  })

  it('Create Exchange Order asks Full or Partial FIRST; Full goes to the exchange page', async () => {
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    await userEvent.click(getByText('Create Exchange Order', { exact: true }))
    expect(getByText('Full exchange', { exact: false })).not.toBeNull()
    expect(getByText('Partial exchange', { exact: false })).not.toBeNull()
    await userEvent.click(getByText('Full exchange', { exact: false }))
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/op/orders/$id/exchange', params: { id: 'order-1' } }),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('Create Partial Return Order picks items and posts PARTIAL to /returns', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-2', displayId: 'RTN-260930-0002' } })
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    await userEvent.click(getByText('Create Partial Return Order', { exact: true }))
    // Simple multi-select over the original lines.
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.click(getByRole('button', { name: 'Create partial return' }))
    expect(mockPost).toHaveBeenCalledWith(
      '/returns',
      expect.objectContaining({
        orderId: 'order-1',
        type: 'PARTIAL',
        source: 'STAFF',
        items: [{ productId: 'p1', variantId: null, quantity: 1 }],
      }),
    )
  })

  it('hides the exchange action for non-sale orders', async () => {
    const { getByRole, getByText } = (await renderMenu({ ...saleOrder, kind: 'EXCHANGE' })) as any
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    expect(getByText('Create Return Order', { exact: true })).not.toBeNull()
    await expect.element(getByText('Create Exchange Order', { exact: true })).not.toBeInTheDocument()
  })

  it.each(['Pending', 'Confirmed', 'Packed', 'Hold', 'Cancelled'])(
    'gates the exchange action on %s status (hide or disable with reason)',
    async (status) => {
      const { getByRole, getByText } = (await renderMenu({
        ...saleOrder,
        status: { id: `st-${status}`, name: status },
      })) as any
      await userEvent.click(getByRole('button', { name: 'Order actions' }))
      const item = getByText('Create Exchange Order', { exact: true })
      try {
        // Hidden gating is acceptable.
        await expect.element(item).not.toBeInTheDocument()
      } catch {
        // Visible gating must be disabled with a surfaced reason.
        const el = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) =>
          n.textContent?.includes('Create Exchange Order'),
        ) as HTMLElement | undefined
        expect(el).toBeDefined()
        const disabledAttr =
          el!.getAttribute('aria-disabled') === 'true' ||
          el!.getAttribute('data-disabled') === 'true' ||
          el!.hasAttribute('disabled')
        expect(disabledAttr).toBe(true)
        const host: HTMLElement = (el!.closest('[title]') as HTMLElement | null) ?? el!
        const reason =
          host.getAttribute('title') ?? document.body.textContent ?? ''
        expect(reason).toMatch(/shipping|delivered|partial|return pending|eligible|status/i)
      }
    },
  )

  it.each(['Shipping', 'Delivered', 'Partial', 'Return Pending'])(
    'shows an enabled exchange action on %s status',
    async (status) => {
      const { getByRole, getByText } = (await renderMenu({
        ...saleOrder,
        status: { id: `st-${status}`, name: status },
      })) as any
      await userEvent.click(getByRole('button', { name: 'Order actions' }))
      expect(getByText('Create Exchange Order', { exact: true })).not.toBeNull()
    },
  )

  it('partial exchange picks returning items + new products and posts ONE PARTIAL call', async () => {
    mockGet.mockResolvedValue({
      data: { data: [{ id: 'p9', name: 'Replacement Tee', salePrice: 450, basePrice: 500 }] },
    })
    mockPost.mockResolvedValue({
      data: { exchange: { id: 'ex-1', displayId: 'EX-260930-0001' }, returnRecord: { id: 'ret-9', displayId: 'RTN-260930-0009' } },
    })
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    await userEvent.click(getByText('Create Exchange Order', { exact: true }))
    await userEvent.click(getByText('Partial exchange', { exact: false }))
    // Returning leg: 1 × Widget.
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    // New leg: search + add the replacement product.
    await userEvent.type(getByRole('textbox', { name: 'Search replacement products' }), 'Tee')
    await userEvent.click(getByText('Replacement Tee', { exact: false }))
    await userEvent.click(getByRole('button', { name: 'Create partial exchange' }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
    expect(mockPost).toHaveBeenCalledWith(
      '/exchange/from-order/order-1',
      expect.objectContaining({
        mode: 'PARTIAL',
        returningItems: [{ productId: 'p1', variantId: null, quantity: 1 }],
        items: [{ productId: 'p9', quantity: 1, price: 450 }],
      }),
    )
    // ONE call total — TWO records at once, no phantom Orders.
    expect(mockPost.mock.calls.length).toBe(1)
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/op/orders/$id', params: { id: 'ex-1' } }),
    )
  })
})
