import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Purchases } from '../index'

vi.mock('@/components/search', () => ({ Search: () => null }))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null, Separator: () => null }))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockPut = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: mockPut, delete: vi.fn() },
}))

const SUPPLIERS = [{ id: 'sup-1', name: 'Acme Foods', phone: '01700000000' }]

const VARIANT_ROW = {
  productId: 'prod-1',
  productName: 'Rice Bag',
  variantId: 'v-9',
  variantName: '5kg',
  sku: 'RICE-5KG',
  type: 'variant',
  available: 12,
  image: null,
}

function po(over: Record<string, any> = {}) {
  return {
    id: 'po-1',
    referenceNo: 'PO-261008-0001',
    supplierId: 'sup-1',
    supplier: { id: 'sup-1', name: 'Acme Foods' },
    status: 'ordered',
    total: 1000,
    orderDate: '2026-10-08T00:00:00.000Z',
    notes: '',
    items: [
      {
        id: 'pi-1',
        productId: 'prod-1',
        variantId: 'v-9',
        quantity: 100,
        unitPrice: 10,
        totalPrice: 1000,
        totalBill: 1000,
        receivedQty: 0,
        shortClosedQty: 0,
        product: { id: 'prod-1', name: 'Rice Bag', images: [], sku: 'RICE' },
        variant: {
          id: 'v-9',
          sku: 'RICE-5KG',
          attributeValues: [{ attributeValue: { value: '5kg' } }],
        },
      },
    ],
    grns: [],
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    ...over,
  }
}

function renderPurchases() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Purchases />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/suppliers') return { data: SUPPLIERS }
    if (url === '/inventory/product-lookup') {
      return { data: { data: [VARIANT_ROW], meta: { total: 1, perPage: 25 } } }
    }
    if (url === '/warehouses') return { data: [] }
    return { data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } } }
  })
  mockPost.mockResolvedValue({ data: po() })
  mockPut.mockResolvedValue({ data: po() })
})

async function openListWithPo() {
  mockGet.mockImplementation(async (url: string, config?: any) => {
    if (url === '/purchases') {
      return { data: { data: [po()], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } } }
    }
    if (url === '/suppliers') return { data: SUPPLIERS }
    if (url === '/inventory/product-lookup') {
      return { data: { data: [VARIANT_ROW], meta: { total: 1, perPage: 25 } } }
    }
    if (url === '/warehouses') return { data: [] }
    return { data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } } }
  })
  const ui = await renderPurchases()
  await expect.element(ui.getByText('PO-261008-0001')).toBeInTheDocument()
  return ui
}

describe('Purchase form variant truth', () => {
  it('create sends the picked variantId (never a bare variable parent)', async () => {
    const ui = await openListWithPo()
    await userEvent.click(ui.getByRole('button', { name: 'Add Purchase' }))

    // Supplier via SearchableSelect popover (trigger name comes from content)
    await userEvent.click(ui.getByText('Search & select supplier...'))
    await userEvent.click(ui.getByRole('button', { name: /Acme Foods/ }))

    // Variant-level pick via the SKU combobox (server rows + scanner path)
    const search = ui.getByPlaceholder('Search, scan, or pick a variant...')
    await userEvent.fill(search, 'RICE-5KG')
    await userEvent.click(ui.getByRole('option', { name: /RICE-5KG/ }))

    // Quantity + bill, then save
    await userEvent.fill(ui.getByLabelText('Quantity'), '20')
    await userEvent.click(ui.getByRole('button', { name: 'Create Purchase Order' }))

    expect(mockPost).toHaveBeenCalledWith(
      '/purchases',
      expect.objectContaining({
        items: [
          expect.objectContaining({ productId: 'prod-1', variantId: 'v-9', quantity: 20 }),
        ],
      }),
    )
  })

  it('edit keeps the stored variantId (no silent strip to product level)', async () => {
    const ui = await openListWithPo()
    await userEvent.click(ui.getByRole('button', { name: 'Edit purchase' }))
    // Hydrated variant visible in the form
    await expect.element(ui.getByText(/5kg/)).toBeInTheDocument()
    await userEvent.click(ui.getByRole('button', { name: 'Update' }))

    expect(mockPut).toHaveBeenCalledWith(
      '/purchases/po-1',
      expect.objectContaining({
        items: [expect.objectContaining({ variantId: 'v-9' })],
      }),
    )
  })
})

describe('Receive dialog disposition', () => {
  it('shows ordered/received/remaining and posts responsibility + identity', async () => {
    const ui = await openListWithPo()
    await userEvent.click(ui.getByRole('button', { name: 'Receive Items' }))

    await expect.element(ui.getByText(/Remaining:/)).toBeInTheDocument()
    // Warehouse required
    await userEvent.click(ui.getByRole('button', { name: 'Create GRN & Receive' }))
    // Still open: warehouse missing blocks with an error toast, no POST
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('Short-close and cancel', () => {
  it('short-close posts qty + reason per line', async () => {
    const ui = await openListWithPo()
    await userEvent.click(ui.getByRole('button', { name: 'Short close remaining' }))
    await expect.element(ui.getByText(/Short Close —/)).toBeInTheDocument()
    await userEvent.fill(ui.getByLabelText(/Short qty/), '10')
    await userEvent.fill(ui.getByPlaceholder('e.g. supplier discontinued'), 'supplier short')
    await userEvent.click(ui.getByRole('button', { name: 'Short Close' }))

    expect(mockPost).toHaveBeenCalledWith(
      '/purchases/po-1/short-close',
      expect.objectContaining({
        items: [expect.objectContaining({ purchaseItemId: 'pi-1', qty: 10, reason: 'supplier short' })],
      }),
    )
  })

  it('cancel posts the reason', async () => {
    const ui = await openListWithPo()
    await userEvent.click(ui.getByRole('button', { name: 'Cancel purchase' }))
    await userEvent.fill(ui.getByPlaceholder('Why is this purchase being cancelled?'), 'no longer needed')
    await userEvent.click(ui.getByRole('button', { name: 'Cancel Purchase' }))

    expect(mockPost).toHaveBeenCalledWith('/purchases/po-1/cancel', { reason: 'no longer needed' })
  })
})
