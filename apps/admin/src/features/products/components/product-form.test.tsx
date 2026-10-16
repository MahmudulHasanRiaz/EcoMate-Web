import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductForm } from './product-form'
import { toast } from 'sonner'

const mockGet = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockProductGet = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mockToastError, warning: vi.fn() },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}))

vi.mock('@/features/inventory/hooks/use-inventory-management', () => ({
  useInventoryManagement: () => ({ data: false }),
}))

vi.mock('@/features/gateways/api', () => ({
  productOverrideApi: {
    list: () => Promise.resolve({ data: [] }),
    upsert: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@/features/attributes/api', () => ({
  attributesApi: {
    list: () =>
      Promise.resolve({
        data: [
          {
            id: 'attr-1',
            name: 'Color',
            values: [{ id: 'av-1', value: 'Red', attribute: { name: 'Color' } }],
          },
        ],
      }),
    addValue: vi.fn(),
  },
}))

vi.mock('@/features/categories/api', () => ({
  categoriesApi: { list: () => Promise.resolve({ data: [] }) },
}))

vi.mock('@/features/brands/api', () => ({
  brandsApi: { list: () => Promise.resolve({ data: [] }) },
}))

vi.mock('@/features/products/api', () => ({
  productsApi: {
    get: mockProductGet,
    create: vi.fn(),
    update: mockUpdate,
    createDraft: vi.fn(() => Promise.resolve({ data: { id: 'draft-1' } })),
    updateDraft: vi.fn(() => Promise.resolve({ data: { id: 'draft-1' } })),
    publishDraft: vi.fn(),
    delete: vi.fn(),
    generateVariants: vi.fn(),
    updateVariant: vi.fn(),
    reorderVariants: vi.fn(),
    removeAllVariants: vi.fn(),
    removeVariant: vi.fn(),
  },
}))

const FULL_PRODUCT = {
  id: 'p1',
  name: 'Test Product',
  slug: 'test-product',
  type: 'simple',
  description: '<p>Desc</p>',
  shortDesc: 'Short text',
  videoUrl: '',
  basePrice: '500',
  salePrice: '450',
  sku: 'TST-1',
  managedStockQuantity: 12,
  lowStockQty: 3,
  categoryId: 'c1',
  productCategories: [{ categoryId: 'c1' }],
  brandId: 'b1',
  tags: ['alpha', 'beta'],
  images: ['https://cdn.example.com/x1.jpg', 'https://cdn.example.com/x2.jpg'],
  seoMeta: { title: 'SEO T', description: 'SEO D', keywords: 'k1' },
  isFeatured: true,
  isActive: true,
  manageStock: true,
  availabilityMode: 'MANAGED_STOCK',
  standardCost: '300',
  sizeChartId: '',
  detailRows: [],
  descriptionSections: {},
  variants: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const VARIABLE_PRODUCT = {
  ...FULL_PRODUCT,
  id: 'p2',
  name: 'Var Product',
  slug: 'var-product',
  type: 'variable',
  sku: 'VAR-1',
  variants: [
    {
      id: 'v-1',
      productId: 'p2',
      sku: 'VAR-1-RED',
      price: '500',
      salePrice: null,
      managedStockQuantity: 5,
      isActive: true,
      images: [],
      image: null,
      attributeValues: [{ attributeValue: { id: 'av-1', value: 'Red', attribute: { name: 'Color' } } }],
    },
  ],
}

// The product-list row as the table passes it: id + scalars, but no images /
// description — the form must upgrade to the full GET for those.
const LIST_ROW = {
  id: 'p1',
  name: 'Test Product',
  slug: 'test-product',
  type: 'simple',
  description: null,
  shortDesc: null,
  basePrice: '500',
  salePrice: '450',
  sku: 'TST-1',
  managedStockQuantity: 12,
  lowStockQty: 3,
  categoryId: 'c1',
  tags: ['alpha', 'beta'],
  images: [],
  seoMeta: {},
  isFeatured: true,
  isActive: true,
  manageStock: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  variants: [],
} as any

function Harness({ row = LIST_ROW }: { row?: any }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid='open-form'>open-form</button>
      <ProductForm open={open} onOpenChange={setOpen} currentRow={row} mode='edit' />
    </>
  )
}

function renderForm(row: any = LIST_ROW) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness row={row} />
    </QueryClientProvider>,
  )
}

// Close via the dialog X and wait until the content is FULLY unmounted —
// reopening while the exit animation still holds the content would batch the
// open-state flip and legitimately skip the repopulation effect.
async function closeViaX(ui: Awaited<ReturnType<typeof renderForm>>) {
  await userEvent.click(ui.getByRole('button', { name: 'Close' }))
  await vi.waitFor(() => {
    expect(document.querySelector('input[placeholder="Product name"]')).toBeNull()
  })
}

describe('ProductForm edit-mode initialization (staging regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      const u = String(url)
      if (u.startsWith('/size-charts')) return Promise.resolve({ data: [] })
      if (u.startsWith('/categories/')) return Promise.resolve({ data: { id: 'c1', sizeChartId: null } })
      if (u.startsWith('/products/check-slug') || u.startsWith('/products/check-sku')) {
        return Promise.resolve({ data: { available: true } })
      }
      return Promise.resolve({ data: [] })
    })
    mockProductGet.mockImplementation(() => Promise.resolve({ data: FULL_PRODUCT }))
    mockUpdate.mockImplementation(() => Promise.resolve({ data: { ...FULL_PRODUCT } }))
  })

  it('fills every persisted field from the full product once the GET resolves', async () => {
    const ui = await renderForm()

    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')
    await expect.element(ui.getByPlaceholder('product-slug')).toHaveValue('test-product')
    await expect.element(ui.getByPlaceholder('PRD-001')).toHaveValue('TST-1')
    await expect.element(ui.getByPlaceholder('product-slug')).toBeInTheDocument()

    // Price fields (id-addressed) reflect the stored values.
    await vi.waitFor(() => {
      const base = document.getElementById('product-field-basePrice') as HTMLInputElement | null
      const sale = document.getElementById('product-field-salePrice') as HTMLInputElement | null
      expect(base?.value).toBe('500')
      expect(sale?.value).toBe('450')
    })
  })

  it('reopening the SAME product after closing repopulates the form (ghost guard regression)', async () => {
    const ui = await renderForm()
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    // Close via the dialog's X — this runs flush + reset exactly like the
    // reported bug path.
    await closeViaX(ui)

    // Reopen the same row.
    await userEvent.click(ui.getByTestId('open-form'))
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')
    await expect.element(ui.getByPlaceholder('PRD-001')).toHaveValue('TST-1')
  })

  it('saving an untouched re-opened product sends the full payload — images preserved, no phantom name error', async () => {
    const ui = await renderForm()
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await closeViaX(ui)
    await userEvent.click(ui.getByTestId('open-form'))
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await userEvent.click(ui.getByRole('button', { name: 'Update Product' }))
    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))

    const [id, payload] = mockUpdate.mock.calls[0]
    expect(id).toBe('p1')
    expect(payload.name).toBe('Test Product')
    expect(payload.images).toEqual(FULL_PRODUCT.images)
    expect(payload.basePrice).toBe(500)
    expect(payload.salePrice).toBe(450)
    expect(payload.sku).toBe('TST-1')
    expect(payload.seoMeta).toMatchObject({ title: 'SEO T', description: 'SEO D', keywords: 'k1' })
    expect(mockToastError).not.toHaveBeenCalledWith('Product name is required')
  })

  it('a name-only edit keeps the stored images byte-identical in the payload', async () => {
    const ui = await renderForm()
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await userEvent.fill(ui.getByPlaceholder('Product name'), 'Renamed Product')
    await userEvent.click(ui.getByRole('button', { name: 'Update Product' }))
    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))

    const [, payload] = mockUpdate.mock.calls[0]
    expect(payload.name).toBe('Renamed Product')
    expect(payload.images).toEqual(FULL_PRODUCT.images)
  })

  it('editing and closing prompts before discarding unsaved changes', async () => {
    const ui = await renderForm()
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    await userEvent.fill(ui.getByPlaceholder('Product name'), 'Changed')
    await expect.element(ui.getByTestId('unsaved-changes-indicator')).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Close' }))
    await expect.element(ui.getByText('Discard unsaved changes?')).toBeInTheDocument()

    // Keep editing: the form stays open with the edit intact.
    await userEvent.click(ui.getByRole('button', { name: 'Cancel' }))
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Changed')

    // Close again and discard.
    await userEvent.click(ui.getByRole('button', { name: 'Close' }))
    await userEvent.click(ui.getByRole('button', { name: 'Discard changes' }))
    await vi.waitFor(() => {
      expect(document.querySelector('input[placeholder="Product name"]')).toBeNull()
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('variable product loads its variants from the full product in edit mode', async () => {
    mockProductGet.mockImplementation(() => Promise.resolve({ data: VARIABLE_PRODUCT }))
    const ui = await renderForm({ ...LIST_ROW, id: 'p2', name: 'Var Product', type: 'variable', sku: 'VAR-1', variants: [] })

    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Var Product')
    await userEvent.click(ui.getByRole('tab', { name: 'Variants' }))

    await expect.element(ui.getByText('VAR-1-RED')).toBeInTheDocument()
    await expect.element(ui.getByText('Variants (1)')).toBeInTheDocument()
  })

  it('validation errors point at the tab and the field (SEO title)', async () => {
    const ui = await renderForm()
    await expect.element(ui.getByPlaceholder('Product name')).toHaveValue('Test Product')

    // Break the SEO title beyond 60 chars.
    await userEvent.click(ui.getByRole('tab', { name: 'SEO' }))
    await userEvent.fill(ui.getByPlaceholder('SEO title...'), 'X'.repeat(61))

    await userEvent.click(ui.getByRole('button', { name: 'Update Product' }))
    await vi.waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('SEO title'))
    })
    // The SEO tab stays selected and the inline error is rendered.
    await expect.element(ui.getByText('SEO title must be 60 characters or fewer')).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
