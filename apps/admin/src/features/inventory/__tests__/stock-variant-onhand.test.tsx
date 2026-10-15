import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Inventory } from '../index'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a>,
}))
vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/features/inventory/hooks/use-inventory-management', () => ({
  useInventoryManagement: () => ({ data: true }),
}))
vi.mock('../components/inventory-detail-drawer', () => ({ InventoryDetailDrawer: () => null }))
vi.mock('../components/adjust-stock-modal', () => ({ AdjustStockModal: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

/**
 * Variable product whose stock lives at variant level.
 * Mirrors the backend stock-overview shape: the parent carries the aggregate
 * (sum across variants) while each variant carries its own quantities.
 */
const STOCK_OVERVIEW = {
  data: [
    {
      id: 'prod-var-1',
      name: 'Variable Tee',
      slug: 'variable-tee',
      sku: 'TEE-PARENT',
      type: 'variable',
      availabilityMode: 'MANAGED_STOCK',
      managedStockQuantity: 10,
      availableStock: 9,
      manageStock: true,
      lowStockQty: 5,
      basePrice: 500,
      salePrice: null,
      images: [],
      categoryId: null,
      category: null,
      variants: [
        {
          id: 'var-1',
          sku: 'TEE-S',
          managedStockQuantity: 7,
          reservedStock: 1,
          availableStock: 6,
          price: 500,
          attributeValues: [{ attributeValue: { value: 'S' } }],
        },
        {
          id: 'var-2',
          sku: 'TEE-M',
          managedStockQuantity: 3,
          reservedStock: 0,
          availableStock: 3,
          price: 500,
          attributeValues: [{ attributeValue: { value: 'M' } }],
        },
      ],
      _count: { orderItems: 0 },
      reservedStock: 1,
    },
  ],
  meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
}

/** PhysicalInventory rows are per variantId (variantId=null = simple product). */
const PHYSICAL_ROWS = [
  {
    id: 'pi-1',
    productId: 'prod-var-1',
    variantId: 'var-1',
    warehouseId: 'wh-1',
    quantity: 7,
    reservedQuantity: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    product: { id: 'prod-var-1', name: 'Variable Tee', sku: 'TEE-PARENT' },
    variant: {
      id: 'var-1',
      sku: 'TEE-S',
      attributeValues: [{ attributeValue: { value: 'S' } }],
    },
    warehouse: { id: 'wh-1', name: 'Main Warehouse' },
    binLocation: { code: 'A-01' },
  },
  {
    id: 'pi-2',
    productId: 'prod-var-1',
    variantId: 'var-2',
    warehouseId: 'wh-1',
    quantity: 3,
    reservedQuantity: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    product: { id: 'prod-var-1', name: 'Variable Tee', sku: 'TEE-PARENT' },
    variant: {
      id: 'var-2',
      sku: 'TEE-M',
      attributeValues: [{ attributeValue: { value: 'M' } }],
    },
    warehouse: { id: 'wh-1', name: 'Main Warehouse' },
    binLocation: null,
  },
]

type Ui = Awaited<ReturnType<typeof renderInventory>>

function renderInventory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Inventory />
    </QueryClientProvider>,
  )
}

function textOf(el: Element | null | undefined) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim()
}

function bodyRows(ui: Ui): HTMLTableRowElement[] {
  return Array.from(ui.container.querySelectorAll('tbody tr')) as HTMLTableRowElement[]
}

/** First body row whose text contains `text` (all fixture SKUs are distinct). */
function findRow(ui: Ui, text: string): HTMLTableRowElement {
  const row = bodyRows(ui).find((r) => textOf(r).includes(text))
  if (!row) throw new Error(`row containing "${text}" not found`)
  return row
}

function clickButton(ui: Ui, text: string) {
  const btn = Array.from(ui.container.querySelectorAll('button')).find((b) =>
    textOf(b).includes(text),
  )
  if (!btn) throw new Error(`button "${text}" not found`)
  ;(btn as HTMLButtonElement).click()
}

async function onHandColumnIndex(ui: Ui) {
  const headers = Array.from(ui.container.querySelectorAll('thead tr th'))
  const index = headers.findIndex((h) => textOf(h) === 'On Hand')
  if (index < 0) throw new Error('On Hand column not found')
  return { index, headerCount: headers.length }
}

async function expandVariableProduct(ui: Ui) {
  await vi.waitFor(() => {
    findRow(ui, 'Variable Tee')
  })
  // The first button in the parent row is the expand/collapse chevron.
  const chevron = findRow(ui, 'Variable Tee').querySelector('button')
  if (!chevron) throw new Error('expand chevron not found')
  ;(chevron as HTMLButtonElement).click()
  await vi.waitFor(() => {
    findRow(ui, 'TEE-S')
    findRow(ui, 'TEE-M')
  })
}

function rowCells(row: HTMLTableRowElement): string[] {
  return Array.from(row.querySelectorAll('td')).map(textOf)
}

describe('Stock menu — variant-level on-hand rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes('/inventory/stock-overview'))
        return Promise.resolve({ data: STOCK_OVERVIEW })
      if (String(url).includes('/inventory/physical'))
        return Promise.resolve({ data: PHYSICAL_ROWS })
      if (String(url).includes('/warehouses')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
  })

  it('PHYSICAL view: each variant row shows its own on-hand, parent keeps the sum', async () => {
    const ui = await renderInventory()
    await expandVariableProduct(ui)

    const { index: onHandIdx, headerCount } = await onHandColumnIndex(ui)

    const cellsS = rowCells(findRow(ui, 'TEE-S'))
    const cellsM = rowCells(findRow(ui, 'TEE-M'))

    // Variant rows must align with the header — no stray cells.
    expect(cellsS.length).toBe(headerCount)
    expect(cellsM.length).toBe(headerCount)

    // Each variant shows its OWN on-hand (per-variantId PhysicalInventory qty).
    expect(cellsS[onHandIdx]).toBe('7')
    expect(cellsM[onHandIdx]).toBe('3')

    // Parent row keeps the aggregate (7 + 3).
    expect(rowCells(findRow(ui, 'Variable Tee'))[onHandIdx]).toBe('10')
  })

  it('MANAGED view: each variant row shows its own on-hand, parent keeps the sum', async () => {
    const ui = await renderInventory()
    await vi.waitFor(() => {
      findRow(ui, 'Variable Tee')
    })
    clickButton(ui, 'Managed Stock')
    await expandVariableProduct(ui)

    const { index: onHandIdx, headerCount } = await onHandColumnIndex(ui)

    const cellsS = rowCells(findRow(ui, 'TEE-S'))
    const cellsM = rowCells(findRow(ui, 'TEE-M'))

    expect(cellsS.length).toBe(headerCount)
    expect(cellsM.length).toBe(headerCount)

    expect(cellsS[onHandIdx]).toBe('7')
    expect(cellsM[onHandIdx]).toBe('3')

    expect(rowCells(findRow(ui, 'Variable Tee'))[onHandIdx]).toBe('10')
  })
})
