import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

/** Captures the bulk-bar SearchableSelect onChange so tests can drive it. */
let bulkAssignOnChange: ((v: string) => void) | null = null
vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: (props: any) => {
    bulkAssignOnChange = props.onChange
    return null
  },
}))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))

const orderStatuses = [
  { id: 's1', name: 'Pending', color: '#F59E0B', nextStatuses: ['s2'] },
]

const staff = [
  { id: 'st1', firstName: 'Alice', lastName: 'Admin' },
  { id: 'st2', firstName: 'Bob', lastName: 'Cashier' },
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
  customerFirstName: 'John',
  customerLastName: 'Doe',
  customerEmail: 'john@example.com',
  customerPhone: '+1234567890',
  guestName: null,
  guestPhone: null,
  customer: { id: 'c1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', phoneNumber: '+1234567890' },
  status: { id: 's1', name: 'Pending', color: '#F59E0B', nextStatuses: ['s2'] },
  items: [{ id: 'i1', productId: 'p1', quantity: 2, price: '100', product: { id: 'p1', name: 'Eco Bag', images: null } }],
  payments: [],
}

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

function mockSuccessfulAPIs() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/order-statuses') return Promise.resolve({ data: orderStatuses })
    if (url === '/orders') return Promise.resolve({ data: singlePageResponse })
    if (url === '/orders/staff/list') return Promise.resolve({ data: staff })
    if (url === '/couriers/credentials') return Promise.resolve({ data: [] })
    return Promise.reject(new Error('Unexpected URL: ' + url))
  })
}

describe('Orders row actions and bulk assignment', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    bulkAssignOnChange = null
  })

  it('three-dot menu no longer contains an Assign to section', async () => {
    mockSuccessfulAPIs()
    const { container, getByText } = await renderOrders()

    await expect.element(getByText('#ORD-001')).toBeInTheDocument()

    // Open the row's three-dot dropdown. Radix opens on pointerdown — a bare
    // element.click() only fires a synthetic click event (detail 0) and never
    // reaches the trigger's pointer handler.
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.querySelector('svg.lucide-more-horizontal')
    )
    expect(trigger).toBeTruthy()
    await act(async () => {
      trigger!.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', cancelable: true })
      )
    })

    // The menu renders in a portal on document.body.
    await vi.waitFor(() => {
      const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent || '')
      expect(items.some((t) => t.includes('View Details'))).toBe(true)
      expect(items.some((t) => t.includes('Assign to'))).toBe(false)
      expect(items.some((t) => t.includes('Unassign'))).toBe(false)
      expect(items.some((t) => t.includes('Alice'))).toBe(false)
      expect(items.some((t) => t.includes('Bob'))).toBe(false)
    })
  })

  it('bulk-bar Unassign posts assignedToId null (no "unassigned" string leak)', async () => {
    mockSuccessfulAPIs()
    const { container, getByText } = await renderOrders()

    await expect.element(getByText('#ORD-001')).toBeInTheDocument()

    const checkboxes = Array.from(container.querySelectorAll('button[role="checkbox"]'))
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
    await act(async () => {
      checkboxes[1].click()
    })

    expect(bulkAssignOnChange).toBeTruthy()

    mockPost.mockResolvedValue({ data: { updated: 1, total: 1 } })
    await act(async () => {
      bulkAssignOnChange!('unassigned')
    })

    const calls = mockPost.mock.calls.filter((c: any[]) => c[0] === '/orders/bulk/assign')
    expect(calls.length).toBe(1)
    expect(calls[0][1]).toEqual({ ids: ['1'], assignedToId: null })
  })

  it('bulk-bar assigning a staff member posts their id', async () => {
    mockSuccessfulAPIs()
    const { container, getByText } = await renderOrders()

    await expect.element(getByText('#ORD-001')).toBeInTheDocument()

    const checkboxes = Array.from(container.querySelectorAll('button[role="checkbox"]'))
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
    await act(async () => {
      checkboxes[1].click()
    })

    expect(bulkAssignOnChange).toBeTruthy()

    mockPost.mockResolvedValue({ data: { updated: 1, total: 1 } })
    await act(async () => {
      bulkAssignOnChange!('st2')
    })

    const calls = mockPost.mock.calls.filter((c: any[]) => c[0] === '/orders/bulk/assign')
    expect(calls.length).toBe(1)
    expect(calls[0][1]).toEqual({ ids: ['1'], assignedToId: 'st2' })
  })
})
