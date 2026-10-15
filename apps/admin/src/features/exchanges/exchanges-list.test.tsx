import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExchangesList } from './index'

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

const exRow = {
  id: 'ex-1',
  displayId: 'ORD-261014-0002',
  kind: 'EXCHANGE',
  status: { id: 's1', name: 'Shipping' },
  exchangeOfOrderId: 'order-1',
  exchangeOfOrder: { id: 'order-1', displayId: 'ORD-261014-0001' },
  dispatches: [{ id: 'd1', courier: 'steadfast', status: 'DISPATCHED', consignmentId: 'CG-EX-1' }],
  courierService: 'steadfast',
  courierConsignmentId: 'CG-EX-1',
  createdAt: '2026-10-14T11:00:00Z',
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ExchangesList />
    </QueryClientProvider>,
  )
}

describe('ExchangesList (Task 7)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGet.mockImplementation((url: string, opts?: { params?: Record<string, unknown> }) => {
      if (url === '/orders' && opts?.params?.kind === 'EXCHANGE')
        return Promise.resolve({
          data: { data: [exRow], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
        })
      if (url === '/order-statuses') return Promise.resolve({ data: [] })
      if (url === '/returns')
        return Promise.resolve({
          data: { data: [{ id: 'ret-9', displayId: 'RTN-261014-0009', status: 'REQUESTED' }] },
        })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
  })

  it('lists exchange orders with the Exchange badge, original link, dispatch + order status and linked Return', async () => {
    const { getByText } = await renderList()
    await expect.element(getByText('ORD-261014-0002')).toBeInTheDocument()
    await expect.element(getByText('Exchange', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('ORD-261014-0001')).toBeInTheDocument()
    await expect.element(getByText('Shipping')).toBeInTheDocument()
    await expect.element(getByText('RTN-261014-0009')).toBeInTheDocument()
  })

  it('queries kind=EXCHANGE (Returns never leak into the Exchanges list via kind absence)', async () => {
    await renderList()
    await vi.waitFor(() => {
      const calls = mockGet.mock.calls.filter((c: unknown[]) => c[0] === '/orders')
      expect(calls.length).toBeGreaterThan(0)
      for (const c of calls) {
        expect((c[1] as { params: Record<string, unknown> }).params.kind).toBe('EXCHANGE')
      }
    })
  })

  it('sends type=FULL to the server when the Full filter is picked (no client-side filtering)', async () => {
    const { getByRole, getByText } = await renderList()
    await expect.element(getByText('ORD-261014-0002')).toBeInTheDocument()
    await getByRole('combobox').nth(1).click()
    await getByText('Full', { exact: true }).click()
    await vi.waitFor(() => {
      const calls = mockGet.mock.calls.filter(
        (c: unknown[]) =>
          c[0] === '/orders' &&
          (c[1] as { params: Record<string, unknown> }).params.type === 'FULL',
      )
      expect(calls.length).toBeGreaterThan(0)
    })
  })

  it('prefers server exchangeScope for the Type cell when present', async () => {
    mockGet.mockImplementation((url: string, opts?: { params?: Record<string, unknown> }) => {
      if (url === '/orders' && opts?.params?.kind === 'EXCHANGE')
        return Promise.resolve({
          data: {
            data: [{ ...exRow, exchangeScope: 'PARTIAL' }],
            meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
          },
        })
      if (url === '/order-statuses') return Promise.resolve({ data: [] })
      if (url === '/returns') return Promise.resolve({ data: { data: [] } })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    const { getByText } = await renderList()
    await expect.element(getByText('Partial', { exact: true })).toBeInTheDocument()
  })
})
