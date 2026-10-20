import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExchangeDetail } from './detail'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'ex-1' }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: { children?: React.ReactNode; to: string; params?: Record<string, string> }) => (
    <a href={to.replace('$id', params?.id ?? '$id')} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null, Separator: () => null }))
vi.mock('@/components/user-badge', () => ({ UserBadge: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))

const linkedReturn = { id: 'ret-9', displayId: 'RTN-261014-0009', status: 'REQUESTED', items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }] }

/** Full EXCHANGE order exactly as GET /orders/:id returns it (staff). */
const exchangeOrder = {
  id: 'ex-1',
  displayId: 'ORD-261014-0002',
  kind: 'EXCHANGE',
  status: { id: 's1', name: 'Shipping', color: '#3B82F6', nextStatuses: [] },
  subtotal: 1000,
  shippingCharge: 0,
  discount: 0,
  discountType: 'flat',
  total: 1000,
  exchangeScope: 'PARTIAL',
  exchangeOfOrderId: 'order-1',
  exchangedCreditAmount: '350',
  settlementDelta: '150',
  settlementStatus: 'SETTLED_DUE',
  settlementSettledAt: '2026-10-15T10:00:00Z',
  createdAt: '2026-10-14T11:00:00Z',
  updatedAt: '2026-10-14T11:00:00Z',
  trashedAt: null,
  customerFirstName: 'Karim',
  customerLastName: 'Uddin',
  guestName: null,
  customerPhone: '+8801712345678',
  guestPhone: null,
  secondaryPhone: null,
  customerEmail: 'karim@example.com',
  shippingAddress: { address: '12 Road', city: 'Dhaka', zone: '' },
  billingAddress: {},
  customerNotes: null,
  officeNotes: null,
  paymentOptionType: 'FULL_PAYMENT',
  paymentStatus: 'PAID',
  partialAmount: null,
  courierService: 'steadfast',
  courierConsignmentId: 'CG-EX-2',
  courierTrackingCode: 'TRK-EX-2',
  trackingUrl: null,
  editLock: null,
  viewToken: null,
  customer: { id: 'cust-1', name: 'Karim Uddin', email: 'karim@example.com', phone: '+8801712345678' },
  items: [
    {
      productId: 'p-9',
      variantId: null,
      quantity: 2,
      price: 500,
      product: { id: 'p-9', name: 'Red Hoodie', sku: 'HOOD-RED', images: ['/uploads/h.png'], category: { name: 'Apparel' } },
      combo: null,
    },
  ],
  dispatches: [
    {
      id: 'd1',
      courier: 'steadfast',
      status: 'DISPATCHED',
      consignmentId: 'CG-EX-2',
      trackingCode: 'TRK-EX-2',
      trackingUrl: null,
      courierAmount: null,
      createdAt: '2026-10-15T09:00:00Z',
    },
  ],
  payments: [
    { id: 'pay-1', sourceOrderId: 'order-1', sourcePaymentId: null, status: 'PAID', amount: 350 },
  ],
  timeline: [
    { status: 'Pending', timestamp: '2026-10-14T11:00:00Z', note: 'Order created' },
  ],
  returnOfOrder: null,
  returnOrders: [],
  exchangeOfOrder: {
    id: 'order-1',
    displayId: 'ORD-261014-0001',
    kind: 'ORDER',
    subtotal: 2050,
    shippingCharge: 100,
    discount: 50,
    discountType: 'flat',
    total: 2050,
    status: { id: 's2', name: 'Delivered', color: '#22C55E' },
    items: [
      {
        productId: 'p-1',
        variantId: 'v-1',
        quantity: 2,
        price: 600,
        product: { id: 'p-1', name: 'Blue Tee', sku: 'T-BLUE', images: ['/uploads/t.png'] },
        variant: { id: 'v-1', sku: 'T-BLUE-M', image: '/uploads/t-m.png', images: ['/uploads/t-m.png'] },
      },
    ],
  },
}

const ENDPOINTS: Record<string, unknown> = {
  '/order-statuses': [],
  '/shipping/options': [],
  '/system-settings': {},
  '/payments/settings': { gateways: [], global: { staffAutoVerified: false } },
  '/couriers/credentials': [],
}

function mockApis() {
  mockGet.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/orders/ex-1') return Promise.resolve({ data: exchangeOrder })
    if (url.startsWith('/returns')) {
      // Both returnsApi.list and exchangesApi.linkedReturn read the same envelope.
      return Promise.resolve({ data: { data: [linkedReturn], meta: { total: 1, page: 1, limit: 10 } } })
    }
    if (url.startsWith('/exchange/readiness/')) return Promise.resolve({ data: { exchanges: [] } })
    if (url.startsWith('/customers/order-summary')) return Promise.resolve({ data: { summary: {} } })
    if (url.startsWith('/couriers/customer-history')) return Promise.resolve({ data: null })
    if (url.startsWith('/rtn/order/')) return Promise.resolve({ data: null })
    if (ENDPOINTS[url] !== undefined) return Promise.resolve({ data: ENDPOINTS[url] })
    if (url.startsWith('/products')) return Promise.resolve({ data: { data: [], meta: { total: 0 } } })
    return Promise.reject(new Error(`Unexpected URL ${url}`))
  })
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ExchangeDetail />
    </QueryClientProvider>,
  )
}

describe('ExchangeDetail (composed shared order page)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockApis()
  })

  it('renders the shared order page for the exchange: id, customer, dispatch history', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('ORD-261014-0002')).toBeInTheDocument()
    await expect.element(getByText('Karim Uddin')).toBeInTheDocument()
    await expect.element(getByText('Courier Dispatch History')).toBeInTheDocument()
  })

  it('renders the exchange section: PARTIAL chip, old/new goods and billing rows', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('Payment on exchange')).toBeInTheDocument()
    await expect.element(getByText('Blue Tee')).toBeInTheDocument()
    await expect.element(getByText('Red Hoodie').first()).toBeInTheDocument()
    await expect.element(getByText('Credit consumed')).toBeInTheDocument()
  })

  it('backs out to the Exchanges list', async () => {
    const { container, getByText } = await renderDetail()
    await expect.element(getByText('Courier Dispatch History')).toBeInTheDocument()
    const back = container.querySelector('a[href="/op/exchanges"]')
    expect(back).not.toBeNull()
    expect(back?.textContent).toContain('Exchanges')
  })

  it('links the original order and the linked return', async () => {
    const { container, getByText } = await renderDetail()
    await expect.element(getByText('Courier Dispatch History')).toBeInTheDocument()
    expect(container.querySelector('a[href="/op/orders/order-1"]')).not.toBeNull()
    expect(container.querySelector('a[href="/op/returns/ret-9"]')).not.toBeNull()
  })
})

describe('ExchangeDetail (linked return visibility guard)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockApis()
  })

  it('renders nothing (no crashed card) when the linked-return lookup fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/orders/ex-1') return Promise.resolve({ data: exchangeOrder })
      if (url.startsWith('/returns')) return Promise.reject(new Error('lookup failed'))
      if (url.startsWith('/exchange/readiness/')) return Promise.resolve({ data: { exchanges: [] } })
      if (url.startsWith('/customers/order-summary')) return Promise.resolve({ data: { summary: {} } })
      if (url.startsWith('/couriers/customer-history')) return Promise.resolve({ data: null })
      if (url.startsWith('/rtn/order/')) return Promise.resolve({ data: null })
      if (ENDPOINTS[url] !== undefined) return Promise.resolve({ data: ENDPOINTS[url] })
      if (url.startsWith('/products')) return Promise.resolve({ data: { data: [], meta: { total: 0 } } })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    const { container, getByText } = await renderDetail()
    await expect.element(getByText('ORD-261014-0002')).toBeInTheDocument()
    expect(container.querySelector('a[href="/op/returns/ret-9"]')).toBeNull()
  })
})
