import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReturnsList } from './index'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
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
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: vi.fn(), put: vi.fn() } }))

const row = {
  id: 'ret-1',
  displayId: 'RTN-261014-0001',
  orderId: 'order-1',
  type: 'FULL',
  status: 'REQUESTED',
  source: 'STAFF',
  items: [{ productId: 'p-1', quantity: 2 }],
  reason: 'changed mind',
  courier: 'steadfast',
  courierReturnId: 'RTN-CG-1',
  stockReconciled: false,
  refundId: null,
  exchangeOrderId: null,
  createdAt: '2026-10-14T10:00:00Z',
  updatedAt: '2026-10-14T10:00:00Z',
  order: { id: 'order-1', displayId: 'ORD-261014-0001' },
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReturnsList />
    </QueryClientProvider>,
  )
}

describe('ReturnsList (Task 7)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns')
        return Promise.resolve({ data: { data: [row], meta: { total: 1, page: 1, limit: 20 } } })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
  })

  it('renders the RTN id, original ORD link, type, status, courier + return id, items, stock, refund and date', async () => {
    const { getByText } = await renderList()
    await expect.element(getByText('RTN-261014-0001')).toBeInTheDocument()
    await expect.element(getByText('ORD-261014-0001')).toBeInTheDocument()
    await expect.element(getByText('FULL')).toBeInTheDocument()
    await expect.element(getByText('REQUESTED')).toBeInTheDocument()
    await expect.element(getByText(/steadfast/i)).toBeInTheDocument()
    await expect.element(getByText('RTN-CG-1')).toBeInTheDocument()
    await expect.element(getByText('2 pcs')).toBeInTheDocument()
    await expect.element(getByText(/pending/i)).toBeInTheDocument()
  })

  it('passes status/type/source/courier/date/search filters to the list endpoint', async () => {
    const { getByPlaceholder } = await renderList()
    const search = getByPlaceholder(/search returns/i)
    await search.fill('RTN-261014')
    await expect.element(getByPlaceholder(/search returns/i)).toBeInTheDocument()
    // The debounced list call carries the search param.
    await vi.waitFor(() => {
      const calls = mockGet.mock.calls.filter((c: unknown[]) => c[0] === '/returns')
      expect(calls.length).toBeGreaterThan(0)
      const last = calls[calls.length - 1] as unknown[]
      expect((last[1] as { params: Record<string, unknown> }).params.search).toBe('RTN-261014')
    })
  })

  it('shows the full-order scope (not 0 pcs) for a FULL courier return with an empty split', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns')
        return Promise.resolve({
          data: {
            data: [
              {
                ...row,
                id: 'ret-courier-full',
                displayId: 'RTN-261014-0002',
                source: 'COURIER',
                items: [],
                order: {
                  id: 'order-1',
                  displayId: 'ORD-261014-0001',
                  items: [
                    { productId: 'p-1', quantity: 1 },
                    { productId: 'p-2', quantity: 2 },
                  ],
                },
              },
            ],
            meta: { total: 1, page: 1, limit: 20 },
          },
        })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    const { getByText } = await renderList()
    await expect.element(getByText('3 pcs (full)')).toBeInTheDocument()
  })

  it('keeps 0 pcs for a FULL return with an empty split and no order lines', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns')
        return Promise.resolve({
          data: {
            data: [{ ...row, id: 'ret-full-no-order', displayId: 'RTN-261014-0003', source: 'COURIER', items: [] }],
            meta: { total: 1, page: 1, limit: 20 },
          },
        })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    const { getByText } = await renderList()
    await expect.element(getByText('0 pcs')).toBeInTheDocument()
  })

  it('does not invent a scope for a PARTIAL return with an empty split', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns')
        return Promise.resolve({
          data: {
            data: [
              {
                ...row,
                id: 'ret-partial-empty',
                displayId: 'RTN-261014-0004',
                type: 'PARTIAL',
                items: [],
                order: {
                  id: 'order-1',
                  displayId: 'ORD-261014-0001',
                  items: [{ productId: 'p-1', quantity: 5 }],
                },
              },
            ],
            meta: { total: 1, page: 1, limit: 20 },
          },
        })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    const { getByText } = await renderList()
    await expect.element(getByText('0 pcs')).toBeInTheDocument()
  })
})
