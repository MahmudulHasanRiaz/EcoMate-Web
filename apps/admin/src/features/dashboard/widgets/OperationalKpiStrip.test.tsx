import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OperationalKpiStrip, PERIOD_LABELS } from './OperationalKpiStrip'
import { dashboardApi } from '@/features/dashboard/api'
import type { OperationalKpi } from '@/features/dashboard/types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

vi.mock('@/features/dashboard/api', () => ({
  dashboardApi: {
    getOperationalKpis: vi.fn(),
    getLowStockProducts: vi.fn(),
  },
}))

const KPIS: OperationalKpi = {
  newOrders: 1248,
  confirmed: 980,
  packed: 640,
  pickedUp: 512,
  delivered: 470,
  pendingPayments: 7,
  pendingRefunds: 2,
  revenue: 1250000,
}

// Dhaka calendar days expressed as the UTC instants the filter produces.
const RANGE_TODAY = {
  start: new Date('2026-09-20T18:00:00.000Z'), // 00:00 Dhaka on the 21st
  end: new Date('2026-09-21T17:59:59.999Z'),
}

const RANGE_7D = {
  start: new Date('2026-09-14T18:00:00.000Z'),
  end: new Date('2026-09-21T17:59:59.999Z'),
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
}

function wrap(
  client: QueryClient,
  dateRange: { start: Date; end: Date },
  preset: 'today' | 'last_7_days',
) {
  return render(
    <QueryClientProvider client={client}>
      <OperationalKpiStrip
        dateRange={dateRange}
        preset={preset}
        userRole='admin'
        isLoading={false}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dashboardApi.getOperationalKpis).mockResolvedValue({
    data: KPIS,
  } as any)
  vi.mocked(dashboardApi.getLowStockProducts).mockResolvedValue({
    data: { count: 3, products: [] },
  } as any)
})

describe('OperationalKpiStrip', () => {
  it('renders every operational KPI unit with filter-neutral labels', async () => {
    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    for (const label of [
      'New Orders',
      'Confirmed',
      'Packed',
      'Picked Up',
      'Delivered',
      'Pending Payments',
      'Pending Refunds',
      'Revenue',
      'Low Stock',
    ]) {
      await expect
        .element(view.getByText(label, { exact: true }))
        .toBeInTheDocument()
    }
  })

  it('never uses Today-specific labelling', async () => {
    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    await expect
      .element(view.getByText('New Orders', { exact: true }))
      .toBeInTheDocument()
    // The old label implied a hard-coded "today" regardless of the filter.
    await expect
      .element(view.getByText("Today's Orders", { exact: true }))
      .not.toBeInTheDocument()
  })

  it('requests the KPI endpoint with the selected range parameters', async () => {
    await wrap(makeClient(), RANGE_7D, 'last_7_days')

    await vi.waitFor(() => {
      expect(dashboardApi.getOperationalKpis).toHaveBeenCalledWith(
        RANGE_7D.start.toISOString(),
        RANGE_7D.end.toISOString(),
      )
    })
  })

  it('re-fetches with new parameters when the global filter changes', async () => {
    const client = makeClient()
    const view = await wrap(client, RANGE_TODAY, 'today')

    await vi.waitFor(() =>
      expect(dashboardApi.getOperationalKpis).toHaveBeenCalledWith(
        RANGE_TODAY.start.toISOString(),
        RANGE_TODAY.end.toISOString(),
      ),
    )

    await view.rerender(
      <QueryClientProvider client={client}>
        <OperationalKpiStrip
          dateRange={RANGE_7D}
          preset='last_7_days'
          userRole='admin'
          isLoading={false}
        />
      </QueryClientProvider>,
    )

    await vi.waitFor(() =>
      expect(dashboardApi.getOperationalKpis).toHaveBeenCalledWith(
        RANGE_7D.start.toISOString(),
        RANGE_7D.end.toISOString(),
      ),
    )
  })

  it('keys each period separately so a filter change cannot reuse stale data', async () => {
    const client = makeClient()
    await wrap(client, RANGE_TODAY, 'today')

    await vi.waitFor(() => {
      expect(
        client.getQueryData([
          'operational-kpis',
          RANGE_TODAY.start.toISOString(),
          RANGE_TODAY.end.toISOString(),
        ]),
      ).toBeDefined()
    })

    // A different range is a different cache entry — never a stale hit.
    expect(
      client.getQueryData([
        'operational-kpis',
        RANGE_7D.start.toISOString(),
        RANGE_7D.end.toISOString(),
      ]),
    ).toBeUndefined()
  })

  it('renders real values for each tile', async () => {
    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    await vi.waitFor(() => {
      const text = view.container.textContent ?? ''
      expect(text).toContain('1,248') // New Orders
      expect(text).toContain('980') // Confirmed
      expect(text).toContain('640') // Packed
      expect(text).toContain('512') // Picked Up
      expect(text).toContain('470') // Delivered
      expect(text).toContain('7') // Pending Payments
      expect(text).toContain('2') // Pending Refunds
      expect(text).toContain('3') // Low Stock
    })
  })

  it('shows the selected period as the subtext of period tiles and flags snapshots', async () => {
    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    await vi.waitFor(() => {
      expect(view.getByText(PERIOD_LABELS.today).elements().length).toBe(6)
      // Snapshot tiles say so instead of implying a period.
      expect(view.getByText('Backlog').elements().length).toBe(2)
      expect(view.getByText('In stock').elements().length).toBe(1)
    })
  })

  it('renders a dash (never a misleading 0) while loading', async () => {
    vi.mocked(dashboardApi.getOperationalKpis).mockReturnValue(
      new Promise(() => {}) as any,
    )
    vi.mocked(dashboardApi.getLowStockProducts).mockReturnValue(
      new Promise(() => {}) as any,
    )

    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    await vi.waitFor(() => {
      expect(view.getByText('—').elements().length).toBe(9)
    })
  })

  it('renders zeros as real data once loaded (zero state, not an error)', async () => {
    vi.mocked(dashboardApi.getOperationalKpis).mockResolvedValue({
      data: {
        newOrders: 0,
        confirmed: 0,
        packed: 0,
        pickedUp: 0,
        delivered: 0,
        pendingPayments: 0,
        pendingRefunds: 0,
        revenue: 0,
      },
    } as any)
    vi.mocked(dashboardApi.getLowStockProducts).mockResolvedValue({
      data: { count: 0, products: [] },
    } as any)

    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    await vi.waitFor(() => {
      expect(view.getByText('0').elements().length).toBeGreaterThanOrEqual(8)
      // Zero is real data — the unavailable placeholder must be gone.
      expect(view.getByText('—').elements().length).toBe(0)
    })
  })

  it('surfaces a non-misleading error state when the KPI request fails', async () => {
    vi.mocked(dashboardApi.getOperationalKpis).mockRejectedValue(
      new Error('500'),
    )

    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    await expect.element(view.getByRole('alert')).toBeInTheDocument()
    // Never fake a zero when the number is unknown.
    await vi.waitFor(() => {
      expect(view.getByText('—').elements().length).toBeGreaterThan(0)
      expect(view.getByText('0').elements().length).toBe(0)
    })
  })

  it('lays out responsively with a consistent tile height', async () => {
    const view = await wrap(makeClient(), RANGE_TODAY, 'today')

    await vi.waitFor(() => {
      const grid = view.container.querySelector('.grid') as HTMLElement
      expect(grid).toBeTruthy()
      expect(grid.className).toContain('grid-cols-2')
      expect(grid.className).toContain('sm:grid-cols-3')
      expect(grid.className).toContain('lg:grid-cols-5')

      // Every tile is exactly the same height: a fixed height (not min-height)
      // keeps rows uniform regardless of label/subtext length.
      const tiles = view.container.querySelectorAll('.h-\\[104px\\]')
      expect(tiles.length).toBe(9)
      const heights = new Set(
        Array.from(tiles).map((t) => (t as HTMLElement).className.includes('h-[104px]')),
      )
      expect(heights).toEqual(new Set([true]))
    })
  })
})
