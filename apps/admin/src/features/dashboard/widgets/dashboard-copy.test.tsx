import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PendingOrders } from './PendingOrders'
import { RecentOrders } from './RecentOrders'
import { OrderStatusChart } from './OrderStatusChart'
import { dashboardApi } from '@/features/dashboard/api'
import { apiClient } from '@/lib/api-client'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

vi.mock('@/features/dashboard/api', () => ({
  dashboardApi: {
    getPendingOrders: vi.fn(),
    getStats: vi.fn(),
    getOrderStatusDistribution: vi.fn(),
  },
}))

vi.mock('@/features/orders/api', () => ({
  ordersApi: { updateStatus: vi.fn() },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}))

const RANGE_TODAY = {
  start: new Date('2026-09-20T18:00:00.000Z'),
  end: new Date('2026-09-21T17:59:59.999Z'),
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
}

function pendingOrder(i: number) {
  return {
    id: `ord-${i}`,
    displayId: `ORD-260921-${String(i).padStart(4, '0')}`,
    customerName: 'Test Customer',
    customerPhone: '+8801700000000',
    total: 1000 + i,
    status: 'Pending',
    itemCount: 1,
    createdAt: '2026-09-21T06:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiClient.get).mockResolvedValue({ data: [] } as any)
})

describe('dashboard widget copy — basis disclosure (audit G2/G3/G4/G6)', () => {
  describe('PendingOrders', () => {
    it('states the period and the take:20 cap in both views (same data, same copy)', async () => {
      vi.mocked(dashboardApi.getPendingOrders).mockResolvedValue({
        data: [pendingOrder(1)],
      } as any)

      for (const view of ['activity', 'pipeline'] as const) {
        const rendered = await render(
          <QueryClientProvider client={makeClient()}>
            <PendingOrders dateRange={RANGE_TODAY} preset='today' userRole='admin' isLoading={false} view={view} />
          </QueryClientProvider>,
        )
        await expect
          .element(rendered.getByText('Created Today · Still awaiting processing · First 20 shown'))
          .toBeInTheDocument()
        // No view-specific basis claim: the widget takes no view-specific data.
        await expect
          .element(rendered.getByText(/Cohort orders still awaiting processing/))
          .not.toBeInTheDocument()
      }
    })

    it('discloses the cap when 20 rows are shown', async () => {
      vi.mocked(dashboardApi.getPendingOrders).mockResolvedValue({
        data: Array.from({ length: 20 }, (_, i) => pendingOrder(i + 1)),
      } as any)

      const view = await render(
        <QueryClientProvider client={makeClient()}>
          <PendingOrders dateRange={RANGE_TODAY} preset='today' userRole='admin' isLoading={false} />
        </QueryClientProvider>,
      )

      await expect
        .element(view.getByText(/Showing the first 20 — open the order list for the full set/))
        .toBeInTheDocument()
    })

    it('shows no cap note below the cap', async () => {
      vi.mocked(dashboardApi.getPendingOrders).mockResolvedValue({
        data: [pendingOrder(1)],
      } as any)

      const view = await render(
        <QueryClientProvider client={makeClient()}>
          <PendingOrders dateRange={RANGE_TODAY} preset='today' userRole='admin' isLoading={false} />
        </QueryClientProvider>,
      )

      await expect
        .element(view.getByText(/Showing the first 20/))
        .not.toBeInTheDocument()
    })
  })

  describe('RecentOrders', () => {
    it('scopes the Activity copy to the selected period, never "across the store"', async () => {
      vi.mocked(dashboardApi.getStats).mockResolvedValue({
        data: { recentOrders: [pendingOrder(1)] },
      } as any)

      const view = await render(
        <QueryClientProvider client={makeClient()}>
          <RecentOrders dateRange={RANGE_TODAY} preset='today' userRole='admin' isLoading={false} view='activity' />
        </QueryClientProvider>,
      )

      await expect
        .element(view.getByText('Latest orders created · Today'))
        .toBeInTheDocument()
      await expect
        .element(view.getByText(/across the store/))
        .not.toBeInTheDocument()
    })

    it('keeps the cohort wording in the Pipeline view', async () => {
      vi.mocked(dashboardApi.getStats).mockResolvedValue({
        data: { recentOrders: [pendingOrder(1)] },
      } as any)

      const view = await render(
        <QueryClientProvider client={makeClient()}>
          <RecentOrders dateRange={RANGE_TODAY} preset='today' userRole='admin' isLoading={false} view='pipeline' />
        </QueryClientProvider>,
      )

      await expect
        .element(view.getByText('Cohort orders with their current status'))
        .toBeInTheDocument()
    })
  })

  describe('OrderStatusChart', () => {
    it('calls the distribution the period cohort by current status, never "Live pipeline"', async () => {
      vi.mocked(dashboardApi.getOrderStatusDistribution).mockResolvedValue({
        data: [],
      } as any)

      const view = await render(
        <QueryClientProvider client={makeClient()}>
          <OrderStatusChart dateRange={RANGE_TODAY} preset='today' userRole='admin' isLoading={false} />
        </QueryClientProvider>,
      )

      await expect
        .element(
          view.getByText(
            'Orders created in the selected period, grouped by current status — funnel analysis lives in Analytics → Sales',
          ),
        )
        .toBeInTheDocument()
      await expect
        .element(view.getByText(/Live pipeline/))
        .not.toBeInTheDocument()
    })
  })
})
