import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateDispatchDialog } from './create-dispatch-dialog'

const mutateAsync = vi.hoisted(() => vi.fn())

// NOTE: the alias form is required — a relative './hooks' mock silently fails
// to intercept in this setup (component falls through to the real mutation).
vi.mock('@/features/dispatch/hooks', () => ({
  useDispatchMutations: () => ({
    create: { mutateAsync, isPending: false },
  }),
}))

vi.mock('@/stores/license-store', () => ({
  useLicenseStore: (sel: any) => sel({ hasFeature: () => true }),
}))

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const onOpenChange = vi.fn()

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CreateDispatchDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
}

describe('CreateDispatchDialog — minimal manual create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({
      data: {
        data: [
          { id: 'order-1', displayId: 'ORD-001', total: 1200 },
        ],
        total: 1,
      },
    })
    mutateAsync.mockResolvedValue({ id: 'd-1' })
  })

  it('shows order + courier + note fields with identifiers collapsed as optional', async () => {
    const ui = await renderDialog()
    // Core fields always visible…
    await expect.element(ui.getByText('Order', { exact: true })).toBeInTheDocument()
    await expect.element(ui.getByText('Courier', { exact: true })).toBeInTheDocument()
    // …identifiers hidden behind a clearly-optional collapsed section.
    await expect
      .element(ui.getByText('Identifiers (optional)'))
      .toBeInTheDocument()
    expect(
      document.querySelector('[placeholder="Enter consignment ID"]'),
    ).toBeNull()
  })

  it('submits order + courier without identifiers (webhook backfills them)', async () => {
    const ui = await renderDialog()

    // Order selector: search then pick the result.
    await userEvent.click(ui.getByPlaceholder('Search orders…'))
    await userEvent.keyboard('ORD-001')
    await expect.element(ui.getByText('ORD-001')).toBeInTheDocument()
    await userEvent.click(ui.getByText('ORD-001'))

    // Courier select.
    await userEvent.click(ui.getByText('Select courier'))
    await userEvent.click(ui.getByRole('option', { name: 'Steadfast' }))

    await userEvent.click(ui.getByRole('button', { name: 'Create' }))

    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1)
    })
    const payload = mutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({ orderId: 'order-1', courier: 'steadfast' })
    expect(payload).not.toHaveProperty('consignmentId')
    expect(payload).not.toHaveProperty('trackingCode')
  })
})
