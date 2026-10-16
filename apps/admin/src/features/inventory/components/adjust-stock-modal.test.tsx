import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdjustStockModal } from './adjust-stock-modal'

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
      <AdjustStockModal open onOpenChange={() => {}} productId="prod-1" productName="Test Product" availabilityMode="INVENTORY_CONTROLLED" />
    </QueryClientProvider>,
  )
}

describe('AdjustStockModal destructive confirm (Fix 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes('inventory-enabled')) return Promise.resolve({ data: { enabled: true } })
      if (String(url).startsWith('/warehouses')) return Promise.resolve({ data: [{ id: 'wh-1', name: 'Main' }] })
      return Promise.resolve({ data: [] })
    })
  })

  it('guard code → English confirm; Confirm resubmits with confirmDestructive=true', async () => {
    mockPost.mockRejectedValueOnce(CODE_ERR).mockResolvedValue({ data: { ok: true } })
    const ui = await renderModal()
    await userEvent.fill(ui.getByLabelText(/Adjustment Quantity/), '-2')
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select reason' }))
    await userEvent.click(ui.getByRole('option', { name: 'Damage' }))
    await userEvent.click(ui.getByRole('button', { name: 'Save Adjustment' }))

    expect(mockPost).toHaveBeenCalledTimes(1)
    await expect.element(ui.getByText(CONFIRM_TEXT)).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Confirm' }))
    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(mockPost.mock.calls[1][1]).toMatchObject({ quantity: -2, confirmDestructive: true })
  })

  it('Cancel leaves everything unchanged (no resubmit)', async () => {
    mockPost.mockRejectedValueOnce(CODE_ERR)
    const ui = await renderModal()
    await userEvent.fill(ui.getByLabelText(/Adjustment Quantity/), '-2')
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select reason' }))
    await userEvent.click(ui.getByRole('option', { name: 'Damage' }))
    await userEvent.click(ui.getByRole('button', { name: 'Save Adjustment' }))
    await expect.element(ui.getByText(CONFIRM_TEXT)).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Cancel' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    await expect.element(ui.getByText(/Adjust Stock:/)).toBeInTheDocument()
  })
})
