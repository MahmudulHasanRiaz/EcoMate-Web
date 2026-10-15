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
})
