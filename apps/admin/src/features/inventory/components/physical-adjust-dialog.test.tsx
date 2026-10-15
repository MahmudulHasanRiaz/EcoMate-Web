import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PhysicalAdjustDialog } from './physical-adjust-dialog'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const CODE_ERR = { response: { data: { code: 'DESTRUCTIVE_ADJUSTMENT', message: 'server guard' } } }
const CONFIRM_TEXT = 'এই location-এর শেষ ১ পিস সরিয়ে ফেলা হবে (স্টক শূন্য হবে) — নিশ্চিত?'

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PhysicalAdjustDialog open onOpenChange={() => {}} preSelected={{ productId: 'p1' }} />
    </QueryClientProvider>,
  )
}

describe('PhysicalAdjustDialog destructive confirm (Fix 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (String(url) === '/products/p1') {
        return Promise.resolve({
          data: { id: 'p1', name: 'Widget', sku: 'W-1', type: 'simple', standardCost: '10', images: [] },
        })
      }
      if (String(url).startsWith('/warehouses')) return Promise.resolve({ data: [{ id: 'wh-1', name: 'Main' }] })
      return Promise.resolve({ data: [] })
    })
  })

  it('guard code → Bengali confirm; নিশ্চিত resubmits with confirmDestructive=true', async () => {
    mockPost.mockRejectedValueOnce(CODE_ERR).mockResolvedValue({ data: { ok: true } })
    const ui = await renderDialog()
    // Pre-selected product lands in the items table.
    await expect.element(ui.getByText('Widget')).toBeInTheDocument()
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select Warehouse' }))
    await userEvent.click(ui.getByRole('option', { name: 'Main' }))
    await userEvent.fill(ui.getByPlaceholder('e.g., Annual audit count, damage write-off'), 'audit')
    await userEvent.fill(ui.getByPlaceholder('+10 or -5'), '-5')
    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustments' }))

    expect(mockPost).toHaveBeenCalledTimes(1)
    await expect.element(ui.getByText(CONFIRM_TEXT)).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'নিশ্চিত' })).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'বাতিল' })).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'নিশ্চিত' }))
    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(mockPost.mock.calls[1][1]).toMatchObject({ confirmDestructive: true })
  })

  it('বাতিল leaves everything unchanged (no resubmit)', async () => {
    mockPost.mockRejectedValueOnce(CODE_ERR)
    const ui = await renderDialog()
    await expect.element(ui.getByText('Widget')).toBeInTheDocument()
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select Warehouse' }))
    await userEvent.click(ui.getByRole('option', { name: 'Main' }))
    await userEvent.fill(ui.getByPlaceholder('e.g., Annual audit count, damage write-off'), 'audit')
    await userEvent.fill(ui.getByPlaceholder('+10 or -5'), '-5')
    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustments' }))
    await expect.element(ui.getByText(CONFIRM_TEXT)).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'বাতিল' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    await expect.element(ui.getByText('Adjust Physical Stock')).toBeInTheDocument()
  })
})
