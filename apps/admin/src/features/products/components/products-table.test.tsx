import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type PaginationState } from '@tanstack/react-table'
import { ProductsTable } from './products-table'
import { type ProductResponse } from '../api'

vi.mock('../api', () => ({}))

vi.mock('@/features/inventory/hooks/use-inventory-management', () => ({
  useInventoryManagement: () => ({ data: true }),
}))

const mockProduct: ProductResponse = {
  id: '1',
  name: 'Eco Bottle',
  slug: 'eco-bottle',
  type: 'simple',
  description: null,
  shortDesc: null,
  basePrice: '25.00',
  salePrice: null,
  sku: 'ECO-001',
  managedStockQuantity: 50,
  lowStockQty: 5,
  categoryId: 'c1',
  tags: [],
  images: [],
  seoMeta: {},
  isFeatured: false,
  isActive: true,
  manageStock: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  category: { id: 'c1', name: 'Drinkware' },
  variants: [],
}

const defaultPagination: PaginationState = { pageIndex: 0, pageSize: 10 }

function renderTable(overrides: Partial<Parameters<typeof ProductsTable>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductsTable
        data={overrides.data ?? []}
        pageCount={overrides.pageCount ?? 0}
        totalCount={overrides.totalCount ?? (overrides.data ?? []).length}
        pagination={overrides.pagination ?? defaultPagination}
        onPaginationChange={overrides.onPaginationChange ?? vi.fn()}
        isLoading={overrides.isLoading}
        onEdit={overrides.onEdit ?? vi.fn()}
        onDelete={overrides.onDelete ?? vi.fn()}
        selectedIds={overrides.selectedIds ?? []}
        onSelectionChange={overrides.onSelectionChange ?? vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('ProductsTable', () => {
  it('shows loading state when isLoading is true', async () => {
    const { getByText } = await renderTable({ isLoading: true })

    await expect.element(getByText('Loading...')).toBeInTheDocument()
  })

  it('shows empty state when there are no products', async () => {
    const { getByText } = await renderTable({ data: [] })

    await expect.element(getByText('No products found.')).toBeInTheDocument()
  })

  it('renders table with product data', async () => {
    const { getByText } = await renderTable({
      data: [mockProduct],
      pageCount: 1,
    })

    await expect.element(getByText('Eco Bottle')).toBeInTheDocument()
    await expect.element(getByText('SKU: ECO-001')).toBeInTheDocument()
  })

  it('renders multiple products in table rows', async () => {
    const products: ProductResponse[] = [
      mockProduct,
      {
        ...mockProduct,
        id: '2',
        name: 'Bamboo Straw',
        slug: 'bamboo-straw',
        sku: 'ECO-002',
        basePrice: '5.00',
        stock: 0,
      },
    ]

    const { getByText } = await renderTable({ data: products, pageCount: 1 })

    await expect.element(getByText('Eco Bottle')).toBeInTheDocument()
    await expect.element(getByText('Bamboo Straw')).toBeInTheDocument()
  })

  it('renders sale price with strikethrough when product has sale price', async () => {
    const { getByText } = await renderTable({
      data: [{ ...mockProduct, basePrice: '30.00', salePrice: '20.00' }],
      pageCount: 1,
    })

    await expect.element(getByText('৳20.00')).toBeInTheDocument()
  })

  it('renders inactive products with Switch unchecked', async () => {
    const { getByRole } = await renderTable({
      data: [{ ...mockProduct, isActive: false }],
      pageCount: 1,
    })

    const switchBtn = getByRole('switch')
    await expect.element(switchBtn).toBeInTheDocument()
  })

  it('renders active badge for active products', async () => {
    const { getByText } = await renderTable({
      data: [mockProduct],
      pageCount: 1,
    })

    await expect.element(getByText('Active')).toBeInTheDocument()
  })

  it('renders empty data table when data is undefined', async () => {
    const { getByText } = await renderTable({
      data: [] as unknown as ProductResponse[],
    })

    await expect.element(getByText('No products found.')).toBeInTheDocument()
  })
})
