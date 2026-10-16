import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ManagedStockAdjustmentModal } from './managed-stock-adjustment-modal'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const CODE_ERR = { response: { data: { code: 'DESTRUCTIVE_ADJUSTMENT', message: 'server guard' } } }
const CONFIRM_TEXT = 'This removes the last remaining unit(s) at this location — stock will reach zero. Confirm?'

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ManagedStockAdjustmentModal open onOpenChange={() => {}} initialProductId="prod-1" />
    </QueryClientProvider>,
  )
}

describe('ManagedStockAdjustmentModal destructive confirm (Fix 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (String(url).startsWith('/products/prod-1')) {
        return Promise.resolve({
          data: { id: 'prod-1', name: 'Test Product', type: 'simple', availabilityMode: 'MANAGED_STOCK', images: [], variants: [] },
        })
      }
      return Promise.resolve({ data: [] })
    })
  })

  it('guard code → English confirm; Confirm resubmits with confirmDestructive=true', async () => {
    mockPost.mockRejectedValueOnce(CODE_ERR).mockResolvedValue({ data: { ok: true } })
    const ui = await renderModal()
    await userEvent.fill(ui.getByPlaceholder('e.g. 10 or -5'), '-1')
    await userEvent.click(ui.getByRole('button', { name: 'Damaged/Defective' }))
    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustment' }))

    expect(mockPost).toHaveBeenCalledTimes(1)
    await expect.element(ui.getByText(CONFIRM_TEXT)).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Confirm' }))
    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(mockPost.mock.calls[1][1]).toMatchObject({ quantity: -1, confirmDestructive: true })
  })

  it('Cancel leaves everything unchanged (no resubmit)', async () => {
    mockPost.mockRejectedValueOnce(CODE_ERR)
    const ui = await renderModal()
    await userEvent.fill(ui.getByPlaceholder('e.g. 10 or -5'), '-1')
    await userEvent.click(ui.getByRole('button', { name: 'Damaged/Defective' }))
    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustment' }))
    await expect.element(ui.getByText(CONFIRM_TEXT)).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Cancel' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    // Main dialog survives the cancel.
    await expect.element(ui.getByText('Adjust Managed Stock')).toBeInTheDocument()
  })
})
