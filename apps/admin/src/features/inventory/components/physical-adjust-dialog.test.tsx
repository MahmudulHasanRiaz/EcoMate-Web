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
const CONFIRM_TEXT = 'This removes most or all of the remaining available stock at this location. Confirm?'

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PhysicalAdjustDialog open onOpenChange={() => {}} preSelected={{ productId: 'p1' }} />
    </QueryClientProvider>,
  )
}

describe('PhysicalAdjustDialog insufficient-stock pre-validation', () => {
  // Warehouse-level row (no bin): 5. Bin A1 row: 2. No-bin on-hand is the
  // warehouse total (7); bin-1 on-hand is the bin row alone (2).
  const STOCK_ROWS = [
    { id: 'pi-1', productId: 'p1', variantId: null, warehouseId: 'wh-1', binLocationId: null, quantity: 5, reservedQuantity: 0 },
    { id: 'pi-2', productId: 'p1', variantId: null, warehouseId: 'wh-1', binLocationId: 'bin-1', quantity: 2, reservedQuantity: 0 },
  ]

  function mockStockApi(physicalImpl: (url: string) => Promise<unknown>) {
    mockGet.mockImplementation((url: string) => {
      if (String(url) === '/products/p1') {
        return Promise.resolve({
          data: { id: 'p1', name: 'Widget', sku: 'W-1', type: 'simple', standardCost: '10', images: [] },
        })
      }
      if (String(url) === '/inventory/physical') return physicalImpl(url)
      if (String(url) === '/warehouses/wh-1/bin-locations') {
        return Promise.resolve({ data: [{ id: 'bin-1', code: 'A1', zone: 'Zone A' }] })
      }
      if (String(url).startsWith('/warehouses')) return Promise.resolve({ data: [{ id: 'wh-1', name: 'Main' }] })
      return Promise.resolve({ data: [] })
    })
  }

  async function setupDeduction(ui: Awaited<ReturnType<typeof renderDialog>>, qty: string) {
    await expect.element(ui.getByText('Widget')).toBeInTheDocument()
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select Warehouse' }))
    await userEvent.click(ui.getByRole('option', { name: 'Main' }))
    await userEvent.fill(ui.getByPlaceholder('e.g., Annual audit count, damage write-off'), 'audit')
    await userEvent.fill(ui.getByPlaceholder('+10 or -5'), qty)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: { ok: true } })
    mockStockApi(() => Promise.resolve({ data: STOCK_ROWS }))
  })

  it('deduction larger than on-hand is blocked client-side (no server call)', async () => {
    const ui = await renderDialog()
    await setupDeduction(ui, '-10')

    // Inline per-row message + summary alert (on-hand 7 = 5 warehouse + 2 bin).
    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).toBeInTheDocument()
    await expect.element(ui.getByText('Physical stock can never go below zero, so this deduction is rejected with or without confirmation.')).toBeInTheDocument()
    // The destructive-confirmation checkbox is replaced by the alert:
    // confirmation never authorises a below-zero deduction.
    await expect.element(ui.getByText(/Tick to confirm the quantities are intentional/)).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Apply Adjustments' })).toBeDisabled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('deduction within on-hand is allowed (checkbox still offered, posts once)', async () => {
    const ui = await renderDialog()
    await setupDeduction(ui, '-3')

    // Figures loaded: the loading hint is gone and no insufficient message.
    await expect.element(ui.getByText('Checking available stock…')).not.toBeInTheDocument()
    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).not.toBeInTheDocument()
    await expect.element(ui.getByText(/Tick to confirm the quantities are intentional/)).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Apply Adjustments' })).toBeEnabled()

    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustments' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][1]).toMatchObject({ items: [{ quantity: -3 }] })
  })

  it('with a bin picked, the bin row alone is the on-hand figure', async () => {
    const ui = await renderDialog()
    await setupDeduction(ui, '-3')

    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'No bin (warehouse-level)' }))
    await userEvent.click(ui.getByRole('option', { name: 'A1 (Zone A)' }))

    // Bin A1 holds 2, so -3 is insufficient even though the warehouse total is 7.
    await expect.element(ui.getByText('Insufficient stock — only 2 available.')).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Apply Adjustments' })).toBeDisabled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('loading figures never falsely block: submit falls back to the server', async () => {
    mockStockApi(() => new Promise(() => {})) // never resolves
    const ui = await renderDialog()
    await setupDeduction(ui, '-10')

    await expect.element(ui.getByText('Checking available stock…')).toBeInTheDocument()
    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Apply Adjustments' })).toBeEnabled()

    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustments' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][1]).toMatchObject({ items: [{ quantity: -10 }] })
  })

  it('failed figures query never crashes: submit falls back to the server', async () => {
    mockStockApi(() => Promise.reject(new Error('stock boom')))
    const ui = await renderDialog()
    await setupDeduction(ui, '-10')

    await expect.element(ui.getByText('Checking available stock…')).not.toBeInTheDocument()
    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Apply Adjustments' })).toBeEnabled()

    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustments' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][1]).toMatchObject({ items: [{ quantity: -10 }] })
  })
})

describe('PhysicalAdjustDialog destructive confirm (Fix 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (String(url) === '/products/p1') {
        return Promise.resolve({
          data: { id: 'p1', name: 'Widget', sku: 'W-1', type: 'simple', standardCost: '10', images: [] },
        })
      }
      // Pre-validation on-hand for p1: 10, so the -5 deductions below pass
      // the client check and reach the mocked server guard.
      if (String(url) === '/inventory/physical') {
        return Promise.resolve({
          data: [{ id: 'pi-1', productId: 'p1', variantId: null, warehouseId: 'wh-1', binLocationId: null, quantity: 10, reservedQuantity: 0 }],
        })
      }
      if (String(url).startsWith('/warehouses')) return Promise.resolve({ data: [{ id: 'wh-1', name: 'Main' }] })
      return Promise.resolve({ data: [] })
    })
  })

  it('guard code → English confirm; Confirm resubmits with confirmDestructive=true', async () => {
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
    await expect.element(ui.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Confirm' }))
    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(mockPost.mock.calls[1][1]).toMatchObject({ confirmDestructive: true })
  })

  it('Cancel leaves everything unchanged (no resubmit)', async () => {
    mockPost.mockRejectedValueOnce(CODE_ERR)
    const ui = await renderDialog()
    await expect.element(ui.getByText('Widget')).toBeInTheDocument()
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select Warehouse' }))
    await userEvent.click(ui.getByRole('option', { name: 'Main' }))
    await userEvent.fill(ui.getByPlaceholder('e.g., Annual audit count, damage write-off'), 'audit')
    await userEvent.fill(ui.getByPlaceholder('+10 or -5'), '-5')
    await userEvent.click(ui.getByRole('button', { name: 'Apply Adjustments' }))
    await expect.element(ui.getByText(CONFIRM_TEXT)).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Cancel' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    await expect.element(ui.getByText('Adjust Physical Stock')).toBeInTheDocument()
  })
})
