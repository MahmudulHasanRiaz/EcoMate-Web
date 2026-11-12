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
const CONFIRM_TEXT = 'This removes most or all of the remaining available stock at this location. Confirm?'

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
      // On-hand for prod-1 is 10, so the -2 deductions below pass the
      // client-side insufficient-stock guard and reach the mocked server.
      if (String(url) === '/inventory/physical') {
        return Promise.resolve({
          data: [{ id: 'pi-1', productId: 'prod-1', variantId: null, warehouseId: 'wh-1', binLocationId: null, quantity: 10, reservedQuantity: 0 }],
        })
      }
      if (String(url).includes('bin-locations')) return Promise.resolve({ data: [] })
      if (String(url).includes('/zones') || String(url).includes('/racks') || String(url).includes('/shelves')) return Promise.resolve({ data: [] })
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
    await expect.element(ui.getByText(/Adjust Physical Stock:/)).toBeInTheDocument()
  })
})

describe('AdjustStockModal insufficient-stock pre-validation', () => {
  // Warehouse-level row (no bin): 5. Bin A1 row: 2. No-bin on-hand is the
  // warehouse total (7); bin-1 on-hand is the bin row alone (2).
  const STOCK_ROWS = [
    { id: 'pi-1', productId: 'prod-1', variantId: null, warehouseId: 'wh-1', binLocationId: null, quantity: 5, reservedQuantity: 0 },
    { id: 'pi-2', productId: 'prod-1', variantId: null, warehouseId: 'wh-1', binLocationId: 'bin-1', quantity: 2, reservedQuantity: 0 },
  ]

  function mockStockApi(physicalImpl: (url: string) => Promise<unknown>) {
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes('inventory-enabled')) return Promise.resolve({ data: { enabled: true } })
      if (String(url) === '/inventory/physical') return physicalImpl(url)
      if (String(url).includes('bin-locations')) {
        return Promise.resolve({ data: [{ id: 'bin-1', code: 'A1' }] })
      }
      if (String(url).includes('/zones') || String(url).includes('/racks') || String(url).includes('/shelves')) return Promise.resolve({ data: [] })
      if (String(url).startsWith('/warehouses')) return Promise.resolve({ data: [{ id: 'wh-1', name: 'Main' }] })
      return Promise.resolve({ data: [] })
    })
  }

  async function setupDeduction(ui: Awaited<ReturnType<typeof renderModal>>, qty: string) {
    // Single warehouse auto-selects; the stock figures then load.
    await userEvent.fill(ui.getByLabelText(/Adjustment Quantity/), qty)
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select reason' }))
    await userEvent.click(ui.getByRole('option', { name: 'Damage' }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: { ok: true } })
    mockStockApi(() => Promise.resolve({ data: STOCK_ROWS }))
  })

  it('deduction larger than on-hand is blocked client-side (no server call, no confirm)', async () => {
    // Even a server that WOULD fire the destructive-confirm guard must
    // never be reached: the confirm dialog is only for large WITHIN-stock
    // deductions.
    mockPost.mockRejectedValueOnce(CODE_ERR)
    const ui = await renderModal()
    await setupDeduction(ui, '-19')

    // Inline alert (on-hand 7 = 5 warehouse + 2 bin).
    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).toBeInTheDocument()
    await expect.element(ui.getByText('Physical stock can never go below zero, so this deduction is rejected with or without confirmation.')).toBeInTheDocument()
    await expect.element(ui.getByText(CONFIRM_TEXT)).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Save Adjustment' })).toBeDisabled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('deduction within on-hand is allowed (posts once)', async () => {
    const ui = await renderModal()
    await setupDeduction(ui, '-3')

    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Save Adjustment' })).toBeEnabled()

    await userEvent.click(ui.getByRole('button', { name: 'Save Adjustment' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][1]).toMatchObject({ quantity: -3, warehouseId: 'wh-1' })
  })

  it('with a bin picked, the bin row alone is the on-hand figure', async () => {
    const ui = await renderModal()
    await setupDeduction(ui, '-3')

    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select bin' }))
    await userEvent.click(ui.getByRole('option', { name: 'A1' }))

    // Bin A1 holds 2, so -3 is insufficient even though the warehouse total is 7.
    await expect.element(ui.getByText('Insufficient stock — only 2 available.')).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Save Adjustment' })).toBeDisabled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('unknown on-hand with no warehouse picked never blocks (Save stays enabled)', async () => {
    // Two warehouses → no auto-select, so the stock query never runs and
    // on-hand stays unknown (null): never treated as 0, never blocks.
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes('inventory-enabled')) return Promise.resolve({ data: { enabled: true } })
      if (String(url).startsWith('/warehouses')) {
        return Promise.resolve({ data: [{ id: 'wh-1', name: 'Main' }, { id: 'wh-2', name: 'Second' }] })
      }
      return Promise.resolve({ data: [] })
    })
    const ui = await renderModal()
    await userEvent.fill(ui.getByLabelText(/Adjustment Quantity/), '-19')

    await expect.element(ui.getByText(/Insufficient stock — only/)).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Save Adjustment' })).toBeEnabled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('loading figures never falsely block: submit falls back to the server', async () => {
    mockStockApi(() => new Promise(() => {})) // never resolves
    const ui = await renderModal()
    await setupDeduction(ui, '-10')

    await expect.element(ui.getByText('Checking available stock…')).toBeInTheDocument()
    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Save Adjustment' })).toBeEnabled()

    await userEvent.click(ui.getByRole('button', { name: 'Save Adjustment' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][1]).toMatchObject({ quantity: -10 })
  })

  it('failed figures query never crashes: submit falls back to the server', async () => {
    mockStockApi(() => Promise.reject(new Error('stock boom')))
    const ui = await renderModal()
    await setupDeduction(ui, '-10')

    await expect.element(ui.getByText('Checking available stock…')).not.toBeInTheDocument()
    await expect.element(ui.getByText('Insufficient stock — only 7 available.')).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Save Adjustment' })).toBeEnabled()

    await userEvent.click(ui.getByRole('button', { name: 'Save Adjustment' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][1]).toMatchObject({ quantity: -10 })
  })

  it('adding stock is unaffected by the guard', async () => {
    const ui = await renderModal()
    await userEvent.fill(ui.getByLabelText(/Adjustment Quantity/), '5')
    await userEvent.fill(ui.getByLabelText(/Unit Cost/), '120')
    await userEvent.click(ui.getByRole('combobox').filter({ hasText: 'Select reason' }))
    await userEvent.click(ui.getByRole('option', { name: 'Damage' }))

    await expect.element(ui.getByText(/Insufficient stock — only/)).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Save Adjustment' })).toBeEnabled()

    await userEvent.click(ui.getByRole('button', { name: 'Save Adjustment' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][1]).toMatchObject({ quantity: 5, unitCost: 120 })
  })
})
