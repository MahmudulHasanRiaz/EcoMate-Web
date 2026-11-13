import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Orders, EmptyState } from './index'
import { ORDER_FILTER_DEFAULTS, useOrdersFilterStore } from '@/stores/orders-filter-store'
// Source text for the "no permanent-delete" guard (same `?raw` pattern as
// the sibling convert-lead test — browser mode has no node:fs).
import ordersIndexSource from './index.tsx?raw'

const mockList = vi.hoisted(() => vi.fn())
const mockRestore = vi.hoisted(() => vi.fn())
const mockTrash = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('./api', () => ({
  ordersApi: { list: mockList, restore: mockRestore, trash: mockTrash },
  mediaUrl: (s: string) => s,
}))
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/features/users/api', () => ({
  usersApi: {
    get: vi.fn(() =>
      Promise.resolve({
        data: {
          id: 'u-1', firstName: 'Sara', lastName: 'Khan', email: 'sara@example.com',
          phoneNumber: '+8801000000001', status: 'active', role: 'employee',
          createdAt: '2024-06-01T00:00:00Z', updatedAt: '2024-06-01T00:00:00Z',
        },
      }),
    ),
  },
}))
vi.mock('@/features/returns/api', () => ({ returnsApi: {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

// Orders is a route page: it renders its own Header/Main chrome. The header
// (sidebar trigger + profile dropdown) is stubbed out entirely so the page
// render stays focused on the list itself.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  // ProfileDropdown (imported by the page, never rendered here — Header is
  // stubbed) imports useLocation at module level; the rest are cheap
  // insurance for the same transitive-import failure.
  useLocation: () => ({ pathname: '/op/orders', href: '/op/orders', search: {} }),
  useParams: () => ({}),
  useSearch: () => ({}),
  useRouter: () => ({ navigate: vi.fn() }),
  Outlet: () => null,
  Link: ({ children, to, params: _params, ...rest }: { children?: React.ReactNode; to: string; params?: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/layout/header', () => ({ Header: () => null }))
vi.mock('@/components/layout/main', () => ({ Main: ({ children }: { children?: React.ReactNode }) => <>{children}</> }))

const STATUSES = [
  { id: 'st-pending', name: 'Pending', color: '#F59E0B', nextStatuses: ['st-confirmed'] },
  { id: 'st-confirmed', name: 'Confirmed', color: '#3B82F6', nextStatuses: [] },
]
const STAFF = [{ id: 'u-1', firstName: 'Sara', lastName: 'Khan' }]

function orderFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    displayId: 'ORD-261113-0001',
    customerId: 'c-1',
    statusId: 'st-pending',
    kind: 'SALE',
    subtotal: 1000, shippingCharge: 60, discount: 0, discountType: 'flat', total: 1060,
    shippingAddress: { address: 'House 1, Road 2', city: 'Dhaka' },
    customerNotes: null, officeNotes: null, timeline: [],
    courierService: null, courierStatus: null, courierTrackingCode: null, courierConsignmentId: null, trackingUrl: null,
    assignedToId: null, assignedAt: null, assignee: null,
    guestName: null, guestPhone: null, secondaryPhone: null,
    customerFirstName: 'Karim', customerLastName: 'Uddin',
    customerPhone: '+8801711000001', customerEmail: 'karim@example.com',
    viewToken: null, paymentMethod: null, paymentMode: null,
    paymentOptionType: 'CASH_ON_DELIVERY', paymentStatus: 'PENDING', partialAmount: null,
    dispatches: [], salesChannel: null, sourcePlatform: null, sourceType: null, sourceEntity: null,
    channel: null, channelEntity: null, sourceSlug: null, acquisitionType: null, sourcePlatformName: null,
    trashedAt: null, createdAt: '2026-11-13T08:00:00Z', updatedAt: '2026-11-13T08:00:00Z',
    customer: { id: 'c-1', firstName: 'Karim', lastName: 'Uddin', email: 'karim@example.com', phoneNumber: '+8801711000001' },
    status: { id: 'st-pending', name: 'Pending', color: '#F59E0B', nextStatuses: ['st-confirmed'] },
    items: [{
      id: 'i-1', productId: 'p-1', variantId: null, quantity: 1, price: 1000,
      product: { id: 'p-1', name: 'Test Product', images: [], slug: 'test-product' },
    }],
    payments: [],
    shipment: null,
    ...overrides,
  }
}

function pageOf(rows: unknown[], total: number, statusCounts: Record<string, number> = {}) {
  return { data: rows, meta: { total, page: 1, perPage: 10, totalPages: 1, statusCounts } }
}

const NORMAL_ROWS = [
  orderFixture({ id: 'o-1', displayId: 'ORD-261113-0001' }),
  orderFixture({ id: 'o-2', displayId: 'ORD-261113-0002', customerFirstName: 'Ayesha', customerLastName: 'Begum' }),
]
const TRASHED_ROWS = [
  orderFixture({ id: 'o-trash-1', displayId: 'ORD-261113-0009', trashedAt: '2026-11-13T10:00:00Z' }),
]

async function renderOrders() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Orders />
    </QueryClientProvider>,
  )
}

describe('EmptyState copy truthfulness', () => {
  it('says "no orders match your filters" (never "placed yet") while any filter is active', async () => {
    const ui = await render(<EmptyState hasActiveFilters onClear={() => {}} />)
    await expect.element(ui.getByText('No orders match your current filters. Try adjusting your search term or clearing filters.')).toBeInTheDocument()
    await expect.element(ui.getByText('No orders have been placed yet in this workspace.')).not.toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('says "placed yet" only with no filters active, and offers no clear button', async () => {
    const ui = await render(<EmptyState hasActiveFilters={false} onClear={() => {}} />)
    await expect.element(ui.getByText('No orders have been placed yet in this workspace.')).toBeInTheDocument()
    await expect.element(ui.getByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('trash view never claims the workspace has no orders', async () => {
    const ui = await render(<EmptyState hasActiveFilters={false} showTrashed onClear={() => {}} />)
    await expect.element(ui.getByText('No trashed orders')).toBeInTheDocument()
    await expect.element(ui.getByText('No orders have been moved to trash yet.')).toBeInTheDocument()
    await expect.element(ui.getByText('No orders have been placed yet in this workspace.')).not.toBeInTheDocument()
  })

  it('trash view with a search says no trashed orders match', async () => {
    const ui = await render(<EmptyState hasActiveFilters showTrashed onClear={() => {}} />)
    await expect.element(ui.getByText('No trashed orders match your current search. Try a different search term.')).toBeInTheDocument()
    await expect.element(ui.getByText('No orders have been placed yet in this workspace.')).not.toBeInTheDocument()
  })
})

describe('Orders list — kind filter Reset + Trash view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    useOrdersFilterStore.setState({ ...ORDER_FILTER_DEFAULTS })
    mockGet.mockImplementation((url: string) => {
      if (url === '/order-statuses') return Promise.resolve({ data: STATUSES })
      if (url === '/orders/staff/list') return Promise.resolve({ data: STAFF })
      if (url === '/couriers/credentials') return Promise.resolve({ data: [] })
      if (url === '/couriers/credential-sets') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
    mockPost.mockResolvedValue({ data: {} })
    mockRestore.mockResolvedValue({ data: {} })
    mockTrash.mockResolvedValue({ data: {} })
    mockList.mockImplementation((query: any) => {
      if (query?.trashedOnly) {
        return Promise.resolve({ data: pageOf(TRASHED_ROWS, 1, { 'st-pending': 1 }) })
      }
      if (query?.kind === 'EXCHANGE') {
        return Promise.resolve({ data: pageOf([], 0, {}) })
      }
      return Promise.resolve({ data: pageOf(NORMAL_ROWS, 2, { 'st-pending': 2 }) })
    })
  })

  it('Reset after a kind filter returns the full list (no stale kind filter)', async () => {
    const ui = await renderOrders()
    await expect.element(ui.getByText('ORD-261113-0001')).toBeInTheDocument()
    await expect.element(ui.getByText('ORD-261113-0002')).toBeInTheDocument()

    // Exchanges: the fixture list has none, so the list empties — but the
    // copy must say "no match", never "no orders placed yet".
    await userEvent.click(ui.getByRole('button', { name: 'Exchanges' }))
    await expect.element(ui.getByText('No orders match your current filters. Try adjusting your search term or clearing filters.')).toBeInTheDocument()
    await expect.element(ui.getByText('No orders have been placed yet in this workspace.')).not.toBeInTheDocument()
    // The kind filter shows in the ACTIVE row with its own clear.
    await expect.element(ui.getByRole('button', { name: 'Clear kind filter: Exchanges' })).toBeInTheDocument()
    // The kind was sent to the list query.
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ kind: 'EXCHANGE' }))

    // Reset clears the kind filter and the full list comes back.
    await userEvent.click(ui.getByRole('button', { name: 'Reset' }))
    await expect.element(ui.getByText('ORD-261113-0001')).toBeInTheDocument()
    await expect.element(ui.getByText('ORD-261113-0002')).toBeInTheDocument()
    // The refetch back to the unfiltered key must carry no kind param
    // (the rows above can render from cache first, so wait for the call).
    await vi.waitFor(() => {
      const lastQuery = mockList.mock.calls.at(-1)?.[0]
      expect(lastQuery?.kind).toBeUndefined()
    })
  })

  it('Trash view fetches trashed-only, shows when trashed, offers Restore, and has no permanent-delete control', async () => {
    const ui = await renderOrders()
    await expect.element(ui.getByText('ORD-261113-0001')).toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Trash' }))
    await vi.waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ includeTrashed: true, trashedOnly: true }))
    })
    await expect.element(ui.getByText('ORD-261113-0009')).toBeInTheDocument()
    await expect.element(ui.getByText(/Trashed/)).toBeInTheDocument()
    await expect.element(ui.getByText(/trashed orders found/)).toBeInTheDocument()

    // Restore is a visible button; there is no permanent-delete control and
    // no "Move to Trash" action on a trashed row.
    await expect.element(ui.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    await expect.element(ui.getByText(/permanently delete/i)).not.toBeInTheDocument()
    await expect.element(ui.getByText('Move to Trash')).not.toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Restore' }))
    expect(mockRestore).toHaveBeenCalledWith('o-trash-1')
  })

  it('renders no permanent-delete button or control for orders, in either view', async () => {
    const ui = await renderOrders()
    await expect.element(ui.getByText('ORD-261113-0001')).toBeInTheDocument()
    await expect.element(ui.getByText(/permanently delete|delete permanently/i)).not.toBeInTheDocument()

    await userEvent.click(ui.getByRole('button', { name: 'Trash' }))
    await expect.element(ui.getByText('ORD-261113-0009')).toBeInTheDocument()
    await expect.element(ui.getByText(/permanently delete|delete permanently/i)).not.toBeInTheDocument()

    // Source-level lock: the orders list must not grow a permanent-delete
    // control (UI copy form — the comment in the feature about having none
    // is hyphenated "permanent-delete" and does not match this).
    expect(ordersIndexSource).not.toMatch(/permanently delete|delete permanently/i)
  })
})
