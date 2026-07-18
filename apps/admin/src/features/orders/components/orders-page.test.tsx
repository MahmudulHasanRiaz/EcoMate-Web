import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Orders } from '../index'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

vi.mock('@/components/search', () => ({ Search: () => null }))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/payment-logo', () => ({ PaymentLogo: () => null }))
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null, Separator: () => null }))
vi.mock('@/components/ui/searchable-select', () => ({ SearchableSelect: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))

const orderStatuses = [
  { id: 's1', name: 'Pending', color: '#F59E0B', nextStatuses: ['s2'] },
  { id: 's2', name: 'Confirmed', color: '#3B82F6', nextStatuses: ['s3'] },
]

const mockOrder = {
  id: '1',
  displayId: '#ORD-001',
  customerId: 'c1',
  statusId: 's1',
  subtotal: '200',
  shippingCharge: '10',
  discount: '0',
  discountType: 'flat',
  total: '210',
  shippingAddress: null,
  customerNotes: null,
  officeNotes: null,
  timeline: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  customer: {
    id: 'c1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phoneNumber: '+1234567890',
  },
  status: {
    id: 's1',
    name: 'Pending',
    color: '#F59E0B',
    nextStatuses: ['s2'],
  },
  items: [
    {
      id: 'i1',
      productId: 'p1',
      quantity: 2,
      price: '100',
      product: { id: 'p1', name: 'Eco Bag', images: null },
    },
  ],
  payments: [],
}

const emptyPageResponse = { data: [], meta: { total: 0, page: 1, perPage: 10, totalPages: 0 } }
const singlePageResponse = {
  data: [mockOrder],
  meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
}

function renderOrders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Orders />
    </QueryClientProvider>
  )
}

function mockSuccessfulAPIs(response?: any) {
    mockGet.mockImplementation((url: string) => {
      if (url === '/order-statuses') return Promise.resolve({ data: orderStatuses })
      if (url === '/orders') return Promise.resolve({ data: response ?? singlePageResponse })
      if (url === '/orders/staff/list') return Promise.resolve({ data: [] })
      if (url === '/couriers/credentials') return Promise.resolve({ data: [] })
      return Promise.reject(new Error('Unexpected URL'))
    })
  }

describe('Orders page', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('renders page heading', async () => {
    mockSuccessfulAPIs()

    const { getByRole } = await renderOrders()

    const heading = getByRole('heading', { level: 2, name: 'Orders' })
    await expect.element(heading).toBeInTheDocument()
  })

  it('shows loading state while fetching orders', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}))

    const { getByRole } = await renderOrders()

    await expect.element(getByRole('heading', { name: 'Orders' })).toBeInTheDocument()
    await expect.element(getByRole('cell', { name: '#ORD-001' })).not.toBeInTheDocument()
  })

  it('shows empty state when there are no orders', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/order-statuses') return Promise.resolve({ data: orderStatuses })
      if (url === '/orders') return Promise.resolve({ data: emptyPageResponse })
      if (url === '/orders/staff/list') return Promise.resolve({ data: [] })
      if (url === '/couriers/credentials') return Promise.resolve({ data: [] })
      return Promise.reject(new Error('Unexpected URL'))
    })

    const { getByText } = await renderOrders()

    await expect.element(getByText(/No orders found/i)).toBeInTheDocument()
  })

  it('renders orders in the table', async () => {
    mockSuccessfulAPIs()

    const { getByText, getByRole } = await renderOrders()

    await expect.element(getByText('#ORD-001')).toBeInTheDocument()
    await expect.element(getByText('John')).toBeInTheDocument()
    await expect.element(getByRole('cell', { name: '৳210.00' })).toBeInTheDocument()
  })

  it('renders customer name and phone in the table', async () => {
    mockSuccessfulAPIs()

    const { getByRole } = await renderOrders()

    await expect.element(getByRole('cell', { name: /John Doe/i })).toBeInTheDocument()
    await expect.element(getByRole('cell', { name: /1234567890/ })).toBeInTheDocument()
  })

  it('shows order total with currency symbol', async () => {
    mockSuccessfulAPIs()

    const { getByRole } = await renderOrders()

    await expect.element(getByRole('cell', { name: /^৳210\.00$/ })).toBeInTheDocument()
  })

  it('shows item count in the table', async () => {
    mockSuccessfulAPIs()

    const { getByRole } = await renderOrders()

    const itemCell = getByRole('cell', { name: '1', exact: true })
    await expect.element(itemCell).toBeInTheDocument()
  })

  it('renders multiple orders in the table', async () => {
    const twoOrderResponse = {
      data: [
        mockOrder,
        {
          ...mockOrder,
          id: '2',
          displayId: '#ORD-002',
          total: '150',
          customer: {
            ...mockOrder.customer,
            firstName: 'Jane',
            lastName: 'Smith',
            phoneNumber: '+9876543210',
          },
          status: { id: 's2', name: 'Confirmed', color: '#3B82F6', nextStatuses: ['s3'] },
        },
      ],
      meta: { total: 2, page: 1, perPage: 10, totalPages: 1 },
    }

    mockSuccessfulAPIs(twoOrderResponse)

    const { getByText, getByRole } = await renderOrders()

    await expect.element(getByText('#ORD-001')).toBeInTheDocument()
    await expect.element(getByText('#ORD-002')).toBeInTheDocument()
    await expect.element(getByText(/Jane Smith/i)).toBeInTheDocument()
    await expect.element(getByRole('cell', { name: '৳150.00' })).toBeInTheDocument()
  })
})
