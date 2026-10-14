import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReturnDetail } from './detail'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'ret-1' }),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null, Separator: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: mockPost, put: vi.fn() } }))

const detail = {
  id: 'ret-1',
  displayId: 'RTN-261014-0001',
  orderId: 'order-1',
  type: 'FULL',
  status: 'IN_TRANSIT',
  source: 'STAFF',
  items: [{ productId: 'p-1', quantity: 2 }],
  reason: 'changed mind',
  courier: 'steadfast',
  courierReturnId: 'RTN-CG-1',
  courierStatus: 'return_list_accepted',
  stockReconciled: false,
  refundId: 'refund-1',
  exchangeOrderId: 'ex-1',
  createdAt: '2026-10-14T10:00:00Z',
  updatedAt: '2026-10-14T10:00:00Z',
  order: { id: 'order-1', displayId: 'ORD-261014-0001' },
  exchangeOrder: { id: 'ex-1', displayId: 'ORD-261014-0002' },
  refund: { id: 'refund-1', status: 'pending' },
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReturnDetail />
    </QueryClientProvider>,
  )
}

describe('ReturnDetail (Task 7)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns/ret-1') return Promise.resolve({ data: detail })
      if (url === '/orders/order-1')
        return Promise.resolve({ data: { id: 'order-1', courierConsignmentId: 'CG-1' } })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    mockPost.mockResolvedValue({ data: { ok: true } })
  })

  it('shows status, items, reason, courier return id, stock state, refund/exchange/original links', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('RTN-261014-0001')).toBeInTheDocument()
    await expect.element(getByText('ORD-261014-0001')).toBeInTheDocument()
    await expect.element(getByText('ORD-261014-0002')).toBeInTheDocument()
    await expect.element(getByText('RTN-CG-1')).toBeInTheDocument()
    await expect.element(getByText('changed mind')).toBeInTheDocument()
    await expect.element(getByText('Check return status')).toBeInTheDocument()
    await expect.element(getByText('Mark received')).toBeInTheDocument()
  })

  it('Check return status posts the consignment id to the reconcile endpoint', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('Check return status')).toBeInTheDocument()
    await getByText('Check return status').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/couriers/steadfast/reconcile-return',
        expect.objectContaining({ consignmentId: 'CG-1' }),
      )
    })
  })

  it('Mark received posts to the mark-received endpoint', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('Mark received')).toBeInTheDocument()
    await getByText('Mark received').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/returns/ret-1/mark-received', {})
    })
  })
})
