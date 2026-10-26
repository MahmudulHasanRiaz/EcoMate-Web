import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OperationalKpiStrip, PERIOD_LABELS } from './OperationalKpiStrip'
import { dashboardApi } from '@/features/dashboard/api'
import { apiClient } from '@/lib/api-client'
import { useOrdersFilterStore } from '@/stores/orders-filter-store'
import type { OperationalKpi, OrderStatusCount } from '@/features/dashboard/types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    onClick,
    children,
  }: {
    to: string
    onClick?: (e: React.MouseEvent) => void
    children: React.ReactNode
  }) => (
    <a
      href={typeof to === 'string' ? to : '#'}
      onClick={(e) => {
        // Stay on the test page (the real target has no route here) while
        // still running the tile's filter side effect.
        e.preventDefault()
        onClick?.(e)
      }}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/features/dashboard/api', () => ({
  dashboardApi: {
    getOperationalKpis: vi.fn(),
    getOperationalPipelineKpis: vi.fn(),
  },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}))

/** The 16 configured order statuses, in lifecycle (sortOrder) sequence. */
const ALL_STATUSES: Array<[string, string]> = [
  ['Pending', '#F59E0B'],
  ['Payment Pending', '#F59E0B'],
  ['Payment Verifying', '#8B5CF6'],
  ['Hold', '#D97706'],
  ['Recall', '#F97316'],
  ['No Response', '#64748B'],
  ['Confirmed', '#3B82F6'],
  ['Packed', '#059669'],
  ['Packing Hold', '#D97706'],
  ['Shipping', '#06B6D4'],
  ['Delivered', '#10B981'],
  ['Partial', '#F59E0B'],
  ['Return Pending', '#EC4899'],
  ['Returned', '#DC2626'],
  ['Damaged', '#991B1B'],
  ['Cancelled', '#EF4444'],
]

function statusCounts(
  counts: Record<string, number>,
): OrderStatusCount[] {
  return ALL_STATUSES.map(([name, color], i) => ({
    name,
    count: counts[name] ?? 0,
    color,
    sortOrder: i,
  }))
}

const KPIS: OperationalKpi = {
  newOrders: 42,
  confirmed: 18,
  packed: 9,
  pickedUp: 14,
  delivered: 31,
  pendingPayments: 0,
  pendingRefunds: 0,
  revenue: 0,
  statusCounts: statusCounts({
    Pending: 42,
    'Payment Pending': 5,
    'Payment Verifying': 2,
    Confirmed: 18,
    Packed: 9,
    Shipping: 14,
    Delivered: 31,
    Cancelled: 3,
  }),
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

/** Card labels in DOM order (the uppercase label span of each kpi-card). */
function cardLabels(view: { container: HTMLElement }): Array<string | null | undefined> {
  return Array.from(view.container.querySelectorAll('.kpi-card')).map(
    (card) =>
      (
        card.querySelector('span.text-\\[11px\\]') as HTMLElement | null
      )?.textContent?.trim(),
  )
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
  view: 'activity' | 'pipeline' = 'activity',
) {
  return render(
    <QueryClientProvider client={client}>
      <OperationalKpiStrip
        dateRange={dateRange}
        preset={preset}
        userRole='admin'
        isLoading={false}
        view={view}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dashboardApi.getOperationalKpis).mockResolvedValue({
    data: KPIS,
  } as any)
  vi.mocked(dashboardApi.getOperationalPipelineKpis).mockResolvedValue({
    data: KPIS,
  } as any)
  // Statuses the tile-click filter resolves names against.
  vi.mocked(apiClient.get).mockResolvedValue({
    data: [
      { id: 'st-pending', name: 'Pending' },
      { id: 'st-ship', name: 'Shipping' },
      { id: 'st-deliv', name: 'Delivered' },
    ],
  } as any)
  useOrdersFilterStore.getState().setStatusFilter('all')
})

describe('OperationalKpiStrip', () => {
  describe('one card per order status', () => {
    it('renders a card for every non-zero order status', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      for (const label of [
        'New Orders',
        'Payment Pending',
        'Payment Verifying',
        'Confirmed',
        'Packed',
        'Shipping',
        'Delivered',
        'Cancelled',
      ]) {
        await expect
          .element(view.getByText(label, { exact: true }))
          .toBeInTheDocument()
      }
    })

    it('shows the Pending status as "New Orders" (never as "Pending")', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await expect.element(view.getByText('New Orders', { exact: true })).toBeInTheDocument()
      await expect
        .element(view.getByText('Pending', { exact: true }))
        .not.toBeInTheDocument()
    })

    it('renders cards in lifecycle (sortOrder) sequence', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        expect(cardLabels(view)).toEqual([
          'New Orders',
          'Payment Pending',
          'Payment Verifying',
          'Confirmed',
          'Packed',
          'Shipping',
          'Delivered',
          'Cancelled',
        ])
      })
    })

    it('renders real values for each tile', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        const text = view.container.textContent ?? ''
        expect(text).toContain('42') // New Orders
        expect(text).toContain('5') // Payment Pending
        expect(text).toContain('2') // Payment Verifying
        expect(text).toContain('18') // Confirmed
        expect(text).toContain('9') // Packed
        expect(text).toContain('14') // Shipping
        expect(text).toContain('31') // Delivered
        expect(text).toContain('3') // Cancelled
      })
    })
  })

  describe('zero-valued statuses are hidden', () => {
    it('hides a status with no orders in the selected period', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      // Zero in the fixture: Hold, Packing Hold, Partial, Return Pending,
      // Returned, Damaged.
      for (const label of [
        'Hold',
        'Packing Hold',
        'Partial',
        'Return Pending',
        'Returned',
        'Damaged',
      ]) {
        await expect
          .element(view.getByText(label, { exact: true }))
          .not.toBeInTheDocument()
      }
    })

    it('hides zero cards in the pipeline view too', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'pipeline')

      await expect.element(view.getByText('Delivered', { exact: true })).toBeInTheDocument()
      await expect
        .element(view.getByText('Damaged', { exact: true }))
        .not.toBeInTheDocument()
    })

    it('drops every card when no status has orders (never shows an empty strip)', async () => {
      vi.mocked(dashboardApi.getOperationalKpis).mockResolvedValue({
        data: { ...KPIS, newOrders: 0, statusCounts: statusCounts({}) },
      } as any)

      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        expect(view.container.querySelectorAll('.kpi-card').length).toBe(0)
      })
    })

    it('re-renders a card when the filter brings that status back', async () => {
      const client = makeClient()
      const view = await wrap(client, RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        expect(view.container.querySelectorAll('.kpi-card').length).toBe(8)
      })

      vi.mocked(dashboardApi.getOperationalKpis).mockResolvedValue({
        data: {
          ...KPIS,
          statusCounts: statusCounts({ Pending: 5, Hold: 2 }),
        },
      } as any)

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

      await vi.waitFor(() => {
        expect(cardLabels(view)).toEqual(['New Orders', 'Hold'])
      })
    })
  })

  describe('non-status cards are gone', () => {
    it('no longer shows refunds, cash collected or low stock tiles', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await expect
        .element(view.getByText('Pending Payments', { exact: true }))
        .not.toBeInTheDocument()
      await expect
        .element(view.getByText('Pending Refunds', { exact: true }))
        .not.toBeInTheDocument()
      await expect
        .element(view.getByText('Cash collected', { exact: true }))
        .not.toBeInTheDocument()
      await expect
        .element(view.getByText('Low Stock', { exact: true }))
        .not.toBeInTheDocument()
    })

    it('only renders order-status tiles', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        expect(view.container.querySelectorAll('.kpi-card').length).toBe(8)
      })
      // One accent per card, as before.
      const tiles = view.container.querySelectorAll('.kpi-card')
      expect(
        Array.from(tiles).every(
          (t) =>
            Array.from((t as HTMLElement).classList).filter((c) =>
              c.startsWith('kpi-accent-'),
            ).length === 1,
        ),
      ).toBe(true)
    })
  })

  describe('loading and error never fake a zero', () => {
    it('renders a dash (not a hidden card) while loading', async () => {
      vi.mocked(dashboardApi.getOperationalKpis).mockReturnValue(
        new Promise(() => {}) as any,
      )

      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        // The known statuses render as — until the real value is known.
        expect(view.getByText('—').elements().length).toBe(16)
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
  })

  describe('filter wiring', () => {
    it('requests the KPI endpoint with the selected range parameters', async () => {
      await wrap(makeClient(), RANGE_7D, 'last_7_days')

      await vi.waitFor(() => {
        expect(dashboardApi.getOperationalKpis).toHaveBeenCalledWith(
          RANGE_7D.start.toISOString(),
          RANGE_7D.end.toISOString(),
        )
      })
    })

    it('keys each period separately so a filter change cannot reuse stale data', async () => {
      const client = makeClient()
      await wrap(client, RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        expect(
          client.getQueryData([
            'operational-kpis',
            'activity',
            RANGE_TODAY.start.toISOString(),
            RANGE_TODAY.end.toISOString(),
          ]),
        ).toBeDefined()
      })

      // A different range is a different cache entry — never a stale hit.
      expect(
        client.getQueryData([
          'operational-kpis',
          'activity',
          RANGE_7D.start.toISOString(),
          RANGE_7D.end.toISOString(),
        ]),
      ).toBeUndefined()
    })

    it('lays out responsively with uniform analytics-style cards', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today')

      await vi.waitFor(() => {
        const grid = view.container.querySelector('.grid') as HTMLElement
        expect(grid).toBeTruthy()
        expect(grid.className).toContain('grid-cols-2')
        expect(grid.className).toContain('sm:grid-cols-3')
        expect(grid.className).toContain('lg:grid-cols-5')
      })
    })
  })

  describe('pipeline view', () => {
    it('fetches the pipeline endpoint (never the activity one) with the same range', async () => {
      await wrap(makeClient(), RANGE_7D, 'last_7_days', 'pipeline')

      await vi.waitFor(() => {
        expect(dashboardApi.getOperationalPipelineKpis).toHaveBeenCalledWith(
          RANGE_7D.start.toISOString(),
          RANGE_7D.end.toISOString(),
        )
      })
      expect(dashboardApi.getOperationalKpis).not.toHaveBeenCalled()
    })

    it('uses identical labels in both views — subtext carries the distinction', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'pipeline')

      // Same names everywhere: two names for one thing confused users.
      await expect.element(view.getByText('New Orders', { exact: true })).toBeInTheDocument()
      await expect.element(view.getByText('Shipping', { exact: true })).toBeInTheDocument()
      await expect.element(view.getByText('Order Cohort', { exact: true })).not.toBeInTheDocument()
      await expect.element(view.getByText('Picked Up', { exact: true })).not.toBeInTheDocument()
    })

    it('marks every status tile as current-state-of-cohort', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'pipeline')

      await vi.waitFor(() => {
        expect(view.getByText(PERIOD_LABELS.today).elements().length).toBeGreaterThan(0)
        // All 8 visible tiles carry the Now-cohort subtext.
        expect(view.getByText('Now · Today cohort').elements().length).toBe(8)
      })
    })

    it('uses the period label as the subtext in the activity view', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'activity')

      await vi.waitFor(() => {
        expect(view.getByText('Today').elements().length).toBe(8)
      })
    })

    it('shows the Total Orders tile from newOrders in the pipeline view', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'pipeline')

      await expect
        .element(view.getByText('Total Orders', { exact: true }))
        .toBeInTheDocument()
      // Leading tile, ahead of the status tiles.
      await vi.waitFor(() => {
        expect(cardLabels(view)[0]).toBe('Total Orders')
      })
    })

    it('does not duplicate the total in the activity view', async () => {
      // Activity "New Orders" already IS newOrders (orders created in the
      // period), so a second tile with the same number would be a
      // confusing duplicate — the activity caption carries the basis note
      // instead.
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'activity')

      await vi.waitFor(() => {
        expect(cardLabels(view)).toEqual([
          'New Orders',
          'Payment Pending',
          'Payment Verifying',
          'Confirmed',
          'Packed',
          'Shipping',
          'Delivered',
          'Cancelled',
        ])
      })
      await expect
        .element(view.getByText('Total Orders', { exact: true }))
        .not.toBeInTheDocument()
    })

    it('states the counting basis for each view', async () => {
      const activity = await wrap(makeClient(), RANGE_TODAY, 'today', 'activity')

      await expect
        .element(activity.getByText(/tiles do not sum to a total/))
        .toBeInTheDocument()

      const pipeline = await wrap(makeClient(), RANGE_TODAY, 'today', 'pipeline')

      await expect
        .element(pipeline.getByText(/tiles sum to Total Orders/))
        .toBeInTheDocument()
    })

    it('clicking a status tile filters the order list to that status', async () => {
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'activity')

      await vi.waitFor(() => {
        expect(cardLabels(view)).toContain('Shipping')
      })
      await view.getByText('Shipping', { exact: true }).click()
      expect(useOrdersFilterStore.getState().statusFilter).toBe('st-ship')
    })

    it('clicking the Total tile clears any status filter', async () => {
      useOrdersFilterStore.getState().setStatusFilter('st-deliv')
      const view = await wrap(makeClient(), RANGE_TODAY, 'today', 'pipeline')

      await view.getByText('Total Orders', { exact: true }).click()
      expect(useOrdersFilterStore.getState().statusFilter).toBe('all')
    })

    it('caches pipeline separately from activity for the same range', async () => {
      const client = makeClient()
      await wrap(client, RANGE_TODAY, 'today', 'pipeline')

      await vi.waitFor(() => {
        expect(
          client.getQueryData([
            'operational-kpis',
            'pipeline',
            RANGE_TODAY.start.toISOString(),
            RANGE_TODAY.end.toISOString(),
          ]),
        ).toBeDefined()
      })
      expect(
        client.getQueryData([
          'operational-kpis',
          'activity',
          RANGE_TODAY.start.toISOString(),
          RANGE_TODAY.end.toISOString(),
        ]),
      ).toBeUndefined()
    })
  })
})
