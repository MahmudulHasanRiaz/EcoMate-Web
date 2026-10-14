import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExchangeDetail } from './detail'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'ex-1' }),
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

describe('ExchangeDetail (Task 7)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url === '/orders/ex-1')
        return Promise.resolve({
          data: {
            id: 'ex-1',
            displayId: 'ORD-261014-0002',
            kind: 'EXCHANGE',
            status: { id: 's1', name: 'Shipping' },
            exchangeOfOrderId: 'order-1',
            exchangeOfOrder: { id: 'order-1', displayId: 'ORD-261014-0001' },
            createdAt: '2026-10-14T11:00:00Z',
          },
        })
      if (url === '/returns')
        return Promise.resolve({
          data: { data: [{ id: 'ret-9', displayId: 'RTN-261014-0009', status: 'REQUESTED' }] },
        })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
  })

  function renderDetail() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <ExchangeDetail />
      </QueryClientProvider>,
    )
  }

  it('shows the Exchange badge, the original-order link and the linked Return RTN link', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('ORD-261014-0002')).toBeInTheDocument()
    await expect.element(getByText('Exchange', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('ORD-261014-0001')).toBeInTheDocument()
    await expect.element(getByText('RTN-261014-0009')).toBeInTheDocument()
  })
})
