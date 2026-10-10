import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReturnOrderDialog } from './return-order-dialog'

const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: mockPost, put: vi.fn(), delete: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const partialOrder = {
  id: 'order-1',
  displayId: 'ORD-260930-0001',
  status: { id: 'st-partial', name: 'Partial', color: '#F59E0B' },
  items: [
    { id: 'item-1', productId: 'p1', variantId: null, comboId: null, quantity: 5, price: 100, product: { id: 'p1', name: 'Product A' }, variant: null },
    { id: 'item-2', productId: 'p2', variantId: null, comboId: null, quantity: 3, price: 200, product: { id: 'p2', name: 'Product B' }, variant: null },
  ],
}

async function renderDialog(order: any = partialOrder) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReturnOrderDialog order={order} open onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('ReturnOrderDialog', () => {
  beforeEach(() => {
    mockPost.mockReset()
  })

  it('shows current quantities, return selectors and remaining for every line', async () => {
    const { getByText } = await renderDialog()
    expect(getByText('Product A')).not.toBeNull()
    expect(getByText('Product B')).not.toBeNull()
    expect(getByText('Current', { exact: false })).not.toBeNull()
    expect(getByText('Remaining', { exact: false })).not.toBeNull()
    // Summary block hidden until something is selected.
    await expect.element(getByText('Returning:', { exact: false })).not.toBeInTheDocument()
  })

  it('prevents invalid quantities client-side (0 < qty ≤ current)', async () => {
    const { getByRole, getByText } = await renderDialog()
    const plusA = getByRole('button', { name: 'Increase return quantity for Product A' })
    for (let i = 0; i < 5; i++) await userEvent.click(plusA)
    // At the cap the + button is disabled.
    await expect.element(plusA).toBeDisabled()
    // Remaining shows 0 for Product A.
    expect(getByText('0', { exact: true })).not.toBeNull()
  })

  it('shows the summary with returning items, adjusted original and the RTN number', async () => {
    const { getByRole, getByText } = await renderDialog()
    const plusA = getByRole('button', { name: 'Increase return quantity for Product A' })
    await userEvent.click(plusA)
    await userEvent.click(plusA)
    expect(getByText('Returning:')).not.toBeNull()
    expect(getByText('× 2', { exact: false })).not.toBeNull()
    expect(getByText('Product A × 3, Product B × 3')).not.toBeNull()
    expect(getByText('RTN-260930-0001')).not.toBeNull()
  })

  it('confirms and submits the selected return quantities', async () => {
    mockPost.mockResolvedValue({
      data: { id: 'rtn-1', displayId: 'RTN-260930-0001', status: { name: 'Return Pending' } },
    })
    const { getByRole } = await renderDialog()
    const plusA = getByRole('button', { name: 'Increase return quantity for Product A' })
    await userEvent.click(plusA)
    await userEvent.click(getByRole('button', { name: 'Create Return Order' }))
    // Empty delta fields are OMITTED (backend defaults to the original's own
    // values, so omitting changes nothing) and the delivered choice is
    // explicit — both are part of the required split contract.
    expect(mockPost).toHaveBeenCalledWith('/rtn/from-order/order-1', {
      items: [{ orderItemId: 'item-1', quantity: 1 }],
      deliverRemainingImmediately: true,
    })
  })

  it('starts both delta fields empty and shows the current values as hints', async () => {
    const { getByLabelText, getByText } = await renderDialog({
      ...partialOrder,
      discount: 200,
      shippingCharge: 60,
    })
    expect((document.getElementById('rtn-adjust-discount') as HTMLInputElement).value).toBe('')
    expect((document.getElementById('rtn-adjust-shipping') as HTMLInputElement).value).toBe('')
    expect(getByText('Current: ৳200.00', { exact: false })).not.toBeNull()
    expect(getByText('Current: ৳60.00', { exact: false })).not.toBeNull()
  })

  it('submits the reason and negative-delta staff adjustments', async () => {
    mockPost.mockResolvedValue({
      data: { id: 'rtn-1', displayId: 'RTN-260930-0001', status: { name: 'Return Pending' } },
    })
    const { getByRole, getByLabelText } = await renderDialog({
      ...partialOrder,
      discount: 200,
      shippingCharge: 60,
    })
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Product A' }))
    await userEvent.fill(getByLabelText(/Return reason/i), 'Wrong size')
    // Staff lowers the discount by 100 and the delivery charge by 20.
    await userEvent.fill(getByLabelText(/Discount delta/i), '-100')
    await userEvent.fill(getByLabelText(/Delivery delta/i), '-20')
    // And answers "no" to the delivered prompt.
    const deliverBox = document.getElementById('rtn-deliver-now') as HTMLInputElement
    expect(deliverBox).not.toBeNull()
    await userEvent.click(deliverBox)

    await userEvent.click(getByRole('button', { name: 'Create Return Order' }))

    expect(mockPost).toHaveBeenCalledWith('/rtn/from-order/order-1', {
      items: [{ orderItemId: 'item-1', quantity: 1 }],
      reason: 'Wrong size',
      adjustOriginalDiscount: 100,
      adjustOriginalDiscountType: 'flat',
      adjustOriginalShippingCharge: 40,
      deliverRemainingImmediately: false,
    })
  })

  it('clamps a large negative delta at zero instead of sending a negative absolute', async () => {
    mockPost.mockResolvedValue({
      data: { id: 'rtn-1', displayId: 'RTN-260930-0001', status: { name: 'Return Pending' } },
    })
    const { getByRole, getByLabelText } = await renderDialog({
      ...partialOrder,
      discount: 200,
      shippingCharge: 60,
    })
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Product A' }))
    await userEvent.fill(getByLabelText(/Delivery delta/i), '-999')
    await userEvent.click(getByRole('button', { name: 'Create Return Order' }))

    expect(mockPost).toHaveBeenCalledWith('/rtn/from-order/order-1', {
      items: [{ orderItemId: 'item-1', quantity: 1 }],
      adjustOriginalShippingCharge: 0,
      deliverRemainingImmediately: true,
    })
  })

  it('enables Create after a single + on 1pc lines (reported stuck-disabled case)', async () => {
    const oneEach = {
      ...partialOrder,
      items: [
        { id: 'item-1', productId: 'p1', variantId: null, comboId: null, quantity: 1, price: 100, product: { id: 'p1', name: 'Product A' }, variant: null },
        { id: 'item-2', productId: 'p2', variantId: null, comboId: null, quantity: 1, price: 200, product: { id: 'p2', name: 'Product B' }, variant: null },
      ],
    }
    const { getByRole } = await renderDialog(oneEach)
    await expect.element(getByRole('button', { name: 'Create Return Order' })).toBeDisabled()
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Product A' }))
    await expect.element(getByRole('button', { name: 'Create Return Order' })).toBeEnabled()
  })

  it('warns when a full return would leave charges on the empty original', async () => {
    const oneEach = {
      ...partialOrder,
      shippingCharge: 60,
      items: [
        { id: 'item-1', productId: 'p1', variantId: null, comboId: null, quantity: 1, price: 100, product: { id: 'p1', name: 'Product A' }, variant: null },
      ],
    }
    const { getByRole, getByText } = await renderDialog(oneEach)
    await userEvent.click(getByRole('button', { name: 'Increase return quantity for Product A' }))
    expect(getByText('Everything is being returned', { exact: false })).not.toBeNull()
    // …and the pointless delivered prompt is hidden when nothing remains.
    expect(document.getElementById('rtn-deliver-now')).toBeNull()
  })

  it('disables confirmation when nothing is selected', async () => {
    const { getByRole } = await renderDialog()
    await expect.element(getByRole('button', { name: 'Create Return Order' })).toBeDisabled()
  })

  it('surfaces server validation errors without closing the dialog', async () => {
    mockPost.mockRejectedValue({
      response: { data: { message: 'Return quantity cannot exceed the current order quantity for "Product A" (available: 5).' } },
    })
    const { getByRole, getByText } = await renderDialog()
    const plusA = getByRole('button', { name: 'Increase return quantity for Product A' })
    await userEvent.click(plusA)
    await userEvent.click(getByRole('button', { name: 'Create Return Order' }))
    await vi.waitFor(() => {
      expect(getByText('Return quantity cannot exceed the current order quantity for "Product A" (available: 5).', { exact: false })).not.toBeNull()
    })
    // Dialog stays open — the table is still there.
    expect(getByText('Product A')).not.toBeNull()
  })
})
