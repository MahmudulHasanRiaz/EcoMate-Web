import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateReturnDialog } from './create-return-dialog'

const mockPost = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))

const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({
  toast: { success: mockToastSuccess, error: mockToastError, warning: vi.fn() },
}))

const order = {
  id: 'order-1',
  displayId: 'ORD-260930-0007',
  kind: 'SALE',
  status: { id: 'st-shipping', name: 'Shipping' },
  subtotal: 1800,
  shippingCharge: 100,
  discount: 50,
  discountType: 'flat',
  total: 1850,
  items: [
    { id: 'oi-1', productId: 'p1', variantId: null, quantity: 3, price: 500, product: { id: 'p1', name: 'Widget' }, variant: null },
    { id: 'oi-2', productId: 'p2', variantId: null, quantity: 1, price: 300, product: { id: 'p2', name: 'Gadget' }, variant: null },
  ],
}

async function renderDialog(orderOverride: any = order) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onClose = vi.fn()
  const page = await render(
    <QueryClientProvider client={client}>
      <CreateReturnDialog order={orderOverride} open onClose={onClose} />
    </QueryClientProvider>,
  )
  return { ...page, onClose }
}

describe('CreateReturnDialog (unified staff return)', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockToastSuccess.mockReset()
    mockToastError.mockReset()
    // No active returns by default.
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns') return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 100 } } })
      return Promise.resolve({ data: {} })
    })
  })

  it('defaults to Partial with the item picker visible', async () => {
    const { getByRole } = await renderDialog()
    expect(
      document.querySelector('[role="radio"][aria-label="Partial return"]')?.getAttribute('aria-checked'),
    ).toBe('true')
    expect(getByRole('button', { name: 'Increase return quantity for Widget' })).not.toBeNull()
  })

  it('caps the picker at ordered − already-returned', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns') {
        return Promise.resolve({
          data: {
            data: [{ id: 'ret-1', displayId: 'RTN-1', type: 'PARTIAL', status: 'REQUESTED', items: [{ productId: 'p1', variantId: null, quantity: 2 }] }],
            meta: { total: 1, page: 1, limit: 100 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const { getByRole } = await renderDialog()
    // Widget: 3 ordered − 2 returned = 1 left → one increase, then capped.
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await expect
      .element(getByRole('button', { name: 'Increase return quantity for Widget' }))
      .toBeDisabled()
  })

  it('partial confirm posts ONE /returns PARTIAL call with the picked lines', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-2', displayId: 'RTN-260930-0002' } })
    const { getByRole } = await renderDialog()
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
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('RTN-260930-0002'))
  })

  it('full mode shows the exactly-once summary and posts the full snapshot', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-3', displayId: 'RTN-260930-0003' } })
    const { getByRole, getByText } = await renderDialog()
    await userEvent.click(getByRole('radio', { name: /full/i }))
    expect(getByText(/Stock restores when the return is marked received — exactly once/i)).not.toBeNull()
    await userEvent.click(getByRole('button', { name: 'Confirm return' }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
    expect(mockPost).toHaveBeenCalledWith(
      '/returns',
      expect.objectContaining({
        orderId: 'order-1',
        type: 'FULL',
        source: 'STAFF',
        items: [
          { productId: 'p1', variantId: null, quantity: 3 },
          { productId: 'p2', variantId: null, quantity: 1 },
        ],
      }),
    )
  })

  it('surfaces the backend guard message verbatim on 4xx', async () => {
    const backendMsg = 'Only 1 left to return for Widget.'
    mockPost.mockRejectedValue({ response: { data: { message: backendMsg } } })
    const { getByRole } = await renderDialog()
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.click(getByRole('button', { name: 'Confirm return' }))
    await expect.poll(() => mockToastError.mock.calls.length).toBe(1)
    expect(mockToastError).toHaveBeenCalledWith(backendMsg)
  })

  it('disables confirm while the request is in flight (no double submit)', async () => {
    let resolvePost!: (v: unknown) => void
    mockPost.mockReturnValue(new Promise((res) => { resolvePost = res }))
    const { getByRole } = await renderDialog()
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    const confirm = getByRole('button', { name: 'Confirm return' })
    await userEvent.click(confirm)
    // In flight the button flips to Creating… and stays disabled.
    await expect.element(getByRole('button', { name: 'Creating…' })).toBeDisabled()
    resolvePost({ data: { id: 'ret-4', displayId: 'RTN-4' } })
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
  })

  it('requires at least one picked line for partial confirm', async () => {
    const { getByRole } = await renderDialog()
    await expect.element(getByRole('button', { name: 'Confirm return' })).toBeDisabled()
  })

  // ——— Billing card + signed per-field adjustments (partial only) ———

  it('shows the billing card on Partial (hidden on Full) with current → new rows', async () => {
    const { getByRole } = await renderDialog()
    const card = document.querySelector('[data-testid="return-billing-card"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('Billing — applied to the original order')
    // Defaults: current == new, so no delta chips.
    expect(card?.textContent).toContain('৳100.00')
    expect(card?.textContent).toContain('৳1850.00')
    await userEvent.click(getByRole('radio', { name: /full/i }))
    expect(document.querySelector('[data-testid="return-billing-card"]')).toBeNull()
  })

  it('live previews signed per-field adjustments with explicit deltas + recomputed total', async () => {
    const { getByTestId } = await renderDialog()
    await userEvent.type(getByTestId('return-shipping-adjustment'), '50')
    await userEvent.type(getByTestId('return-discount-adjustment'), '-20')
    const card = document.querySelector('[data-testid="return-billing-card"]')!
    expect(card.textContent).toContain('৳150.00') // shipping 100 + 50
    expect(card.textContent).toContain('+৳50.00')
    expect(card.textContent).toContain('৳30.00') // discount 50 − 20
    expect(card.textContent).toContain('-৳20.00')
    expect(card.textContent).toContain('৳1920.00') // 1800 + 150 − 30
    expect(card.textContent).toContain('+৳70.00') // total delta 1850 → 1920
  })

  it('posts only non-zero signed adjustments with the partial return', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-5', displayId: 'RTN-260930-0005' } })
    const { getByRole, getByTestId } = await renderDialog()
    await userEvent.type(getByTestId('return-shipping-adjustment'), '50')
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.click(getByRole('button', { name: 'Confirm return' }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
    const body = mockPost.mock.calls[0][1] as any
    expect(body).toMatchObject({ type: 'PARTIAL', shippingAdjustment: 50 })
    expect(body).not.toHaveProperty('discountAdjustment')
  })

  it('omits adjustments entirely when none were entered', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-6', displayId: 'RTN-260930-0006' } })
    const { getByRole } = await renderDialog()
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.click(getByRole('button', { name: 'Confirm return' }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
    const body = mockPost.mock.calls[0][1] as any
    expect(body).not.toHaveProperty('shippingAdjustment')
    expect(body).not.toHaveProperty('discountAdjustment')
  })

  it('blocks confirm + explains when an adjustment would push a field below 0', async () => {
    const { getByRole, getByTestId } = await renderDialog()
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.type(getByTestId('return-shipping-adjustment'), '-500')
    await expect.element(getByRole('button', { name: 'Confirm return' })).toBeDisabled()
    expect(document.body.textContent).toContain('Shipping charge cannot go below 0.')
    await userEvent.clear(getByTestId('return-shipping-adjustment'))
    await userEvent.type(getByTestId('return-shipping-adjustment'), '-50')
    await expect.element(getByRole('button', { name: 'Confirm return' })).not.toBeDisabled()
  })

  it('blocks confirm when the recomputed order total would go negative', async () => {
    const { getByRole, getByTestId } = await renderDialog()
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.type(getByTestId('return-discount-adjustment'), '5000')
    await expect.element(getByRole('button', { name: 'Confirm return' })).toBeDisabled()
    expect(document.body.textContent).toContain('Order total cannot go negative.')
  })

  it('percentage-type orders preview the discount as percent points', async () => {
    const { getByTestId } = await renderDialog({
      ...order,
      discountType: 'percentage',
      discount: 10,
      total: 1720,
    })
    const card = document.querySelector('[data-testid="return-billing-card"]')!
    expect(card.textContent).toContain('10.00%')
    await userEvent.type(getByTestId('return-discount-adjustment'), '5')
    expect(card.textContent).toContain('15.00%')
    expect(card.textContent).toContain('+5.00%')
  })

  it('switching to Full drops the entered adjustments from the payload', async () => {
    mockPost.mockResolvedValue({ data: { id: 'ret-7', displayId: 'RTN-260930-0007' } })
    const { getByRole, getByTestId } = await renderDialog()
    await userEvent.type(getByTestId('return-shipping-adjustment'), '50')
    await userEvent.click(getByRole('radio', { name: /full/i }))
    await userEvent.click(getByRole('button', { name: 'Confirm return' }))
    await expect.poll(() => mockPost.mock.calls.length).toBe(1)
    const body = mockPost.mock.calls[0][1] as any
    expect(body.type).toBe('FULL')
    expect(body).not.toHaveProperty('shippingAdjustment')
  })
})
