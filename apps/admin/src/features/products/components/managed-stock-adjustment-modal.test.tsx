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
const CONFIRM_TEXT = 'This removes most or all of the remaining available stock at this location. Confirm?'

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

describe('ManagedStockAdjustmentModal search mode filter + variant requirement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (String(url) === '/products') {
        return Promise.resolve({
          data: {
            data: [
              { id: 'm-1', name: 'Managed Shoe', sku: 'MS-1', type: 'simple', availabilityMode: 'MANAGED_STOCK', images: [] },
              { id: 'i-1', name: 'Inventory Shoe', sku: 'IS-1', type: 'simple', availabilityMode: 'INVENTORY_CONTROLLED', images: [] },
              { id: 'a-1', name: 'Always Shoe', sku: 'AS-1', type: 'simple', availabilityMode: 'ALWAYS_IN_STOCK', images: [] },
            ],
          },
        })
      }
      if (String(url).startsWith('/products/var-1')) {
        return Promise.resolve({
          data: {
            id: 'var-1', name: 'Variable Hoodie', type: 'variable', availabilityMode: 'MANAGED_STOCK', images: [],
            variants: [
              { id: 'v-s', sku: 'HD-S', managedStockQuantity: 4, attributeValues: [{ attributeValue: { value: 'S' } }] },
              { id: 'v-m', sku: 'HD-M', managedStockQuantity: 2, attributeValues: [{ attributeValue: { value: 'M' } }] },
            ],
          },
        })
      }
      return Promise.resolve({ data: [] })
    })
  })

  it('search offers ONLY managed-mode products', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const ui = await render(
      <QueryClientProvider client={client}>
        <ManagedStockAdjustmentModal open onOpenChange={() => {}} />
      </QueryClientProvider>,
    )
    await userEvent.fill(ui.getByPlaceholder('Search products by name or SKU...'), 'shoe')
    await expect.element(ui.getByText('Managed Shoe')).toBeInTheDocument()
    await expect.element(ui.getByText('Inventory Shoe')).not.toBeInTheDocument()
    await expect.element(ui.getByText('Always Shoe')).not.toBeInTheDocument()
  })

  it('variable product: variants are listed and Apply unlocks once one is selected with a quantity', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const ui = await render(
      <QueryClientProvider client={client}>
        <ManagedStockAdjustmentModal open onOpenChange={() => {}} initialProductId="var-1" />
      </QueryClientProvider>,
    )
    // Variant picker renders every variant (variant selection is required
    // for variable products — the first is auto-selected).
    await expect.element(ui.getByText('HD-S', { exact: false })).toBeInTheDocument()
    await expect.element(ui.getByText('HD-M', { exact: false })).toBeInTheDocument()
    await userEvent.fill(ui.getByPlaceholder('e.g. 10 or -5'), '3')
    await expect.element(ui.getByRole('button', { name: 'Apply Adjustment' })).toBeEnabled()
  })
})
