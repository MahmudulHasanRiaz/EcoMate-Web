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
  payments: [
    { id: 'pay-1', amount: 1000, status: 'PAID', gatewayCode: 'cash' },
  ],
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

  it('renders a Plus menu with exactly ONE return entry (Create return) + exchange', async () => {
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    expect(getByText('Create return', { exact: true })).not.toBeNull()
    expect(getByText('Create Exchange Order', { exact: true })).not.toBeNull()
    // HIGH §2 ONE button: the separate partial entry is deleted — the unified
    // modal (Partial default) covers both. Exactly one staff return entry.
    await expect.element(getByText('Create Partial Return Order', { exact: true })).not.toBeInTheDocument()
    // The old one-click instant entry is gone — no staff return without a modal.
    await expect.element(getByText('Create Return Order', { exact: true })).not.toBeInTheDocument()
    // Exactly one return-labelled menuitem in the open menu.
    const returnItems = Array.from(document.querySelectorAll('[role="menuitem"]')).filter((n) =>
      n.textContent?.toLowerCase().includes('return'),
    )
    expect(returnItems).toHaveLength(1)
  })

  it('Create return opens the modal WITHOUT posting (no one-click instant path)', async () => {
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    await userEvent.click(getByText('Create return', { exact: true }))
    expect(getByRole('radio', { name: /partial/i })).not.toBeNull()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('Create return full confirm posts ONE /returns FULL call with the order snapshot', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-1', displayId: 'RTN-260930-0001' } })
    const { getByRole, getByText } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    await userEvent.click(getByText('Create return', { exact: true }))
    await userEvent.click(getByRole('radio', { name: /full/i }))
    await userEvent.click(getByRole('button', { name: 'Confirm return' }))
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

  it('disables Create return with a tooltip naming the active FULL return', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns') {
        return Promise.resolve({
          data: {
            data: [{ id: 'ret-9', displayId: 'RTN-260930-0009', type: 'FULL', status: 'REQUESTED', items: [] }],
            meta: { total: 1, page: 1, limit: 100 },
          },
        })
      }
      return Promise.resolve({ data: { data: [] } })
    })
    const { getByRole } = await renderMenu()
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    const el = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) =>
      n.textContent?.includes('Create return'),
    ) as HTMLElement | undefined
    expect(el).toBeDefined()
    const disabledAttr =
      el!.getAttribute('aria-disabled') === 'true' ||
      el!.getAttribute('data-disabled') === 'true' ||
      el!.hasAttribute('disabled')
    expect(disabledAttr).toBe(true)
    const host: HTMLElement = (el!.closest('[title]') as HTMLElement | null) ?? el!
    expect(host.getAttribute('title')).toContain('RTN-260930-0009')
  })

  it.each(['Pending', 'Confirmed', 'Packed', 'Cancelled'])(
    'disables Create return on %s status (Shipping/Partial/Delivered only)',
    async (status) => {
      const { getByRole } = await renderMenu({
        ...saleOrder,
        status: { id: `st-${status}`, name: status },
      })
      await userEvent.click(getByRole('button', { name: 'Order actions' }))
      const el = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) =>
        n.textContent?.trim() === 'Create return',
      ) as HTMLElement | undefined
      expect(el).toBeDefined()
      const disabledAttr =
        el!.getAttribute('aria-disabled') === 'true' ||
        el!.getAttribute('data-disabled') === 'true' ||
        el!.hasAttribute('disabled')
      expect(disabledAttr).toBe(true)
      const host: HTMLElement = (el!.closest('[title]') as HTMLElement | null) ?? el!
      expect(host.getAttribute('title')).toMatch(/shipping|partial|delivered/i)
    },
  )

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

  it('unified Create return covers PARTIAL: picks items and posts ONE /returns PARTIAL call', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-2', displayId: 'RTN-260930-0002' } })
    const { getByRole, getByText } = await renderMenu({
      ...saleOrder,
      status: { id: 'st-shipping', name: 'Shipping' },
    })
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    // HIGH §2: no separate partial entry — the unified modal defaults to Partial.
    await expect.element(getByText('Create Partial Return Order', { exact: true })).not.toBeInTheDocument()
    await userEvent.click(getByText('Create return', { exact: true }))
    expect(getByRole('radio', { name: /partial/i })).not.toBeNull()
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.click(getByRole('button', { name: 'Confirm return' }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
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

  it('hides the return action for return-kind orders (single entry point)', async () => {
    const { getByRole, getByText } = (await renderMenu({
      ...saleOrder,
      kind: 'RETURN',
      status: { id: 'st-shipping', name: 'Shipping' },
    })) as any
    // RETURN kind hides every Plus entry (return + exchange), so the
    // menu button itself is gone.
    await expect.element(getByRole('button', { name: 'Order actions' })).not.toBeInTheDocument()
    await expect.element(getByText('Create return', { exact: true })).not.toBeInTheDocument()
  })

  it('hides the exchange action for non-sale orders', async () => {
    const { getByRole, getByText } = (await renderMenu({ ...saleOrder, kind: 'EXCHANGE' })) as any
    await userEvent.click(getByRole('button', { name: 'Order actions' }))
    expect(getByText('Create return', { exact: true })).not.toBeNull()
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
    // Paid-confirm: pre-filled from the ledger Σ PAID, CONFIRM required.
    expect((document.querySelector('#ex-paid-confirmed') as HTMLInputElement)?.value).toBe('1000')
    await userEvent.click(getByRole('checkbox', { name: /i confirm/i }))
    await userEvent.click(getByRole('button', { name: 'Create partial exchange' }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
    expect(mockPost).toHaveBeenCalledWith(
      '/exchange/from-order/order-1',
      expect.objectContaining({
        mode: 'PARTIAL',
        returningItems: [{ productId: 'p1', variantId: null, quantity: 1 }],
        items: [{ productId: 'p9', quantity: 1, price: 450 }],
        paidConfirmed: 1000,
      }),
    )
    // ONE call total — TWO records at once, no phantom Orders.
    expect(mockPost.mock.calls.length).toBe(1)
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/op/orders/$id', params: { id: 'ex-1' } }),
    )
  })
})
