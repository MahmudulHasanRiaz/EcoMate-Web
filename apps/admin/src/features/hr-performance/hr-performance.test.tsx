import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { OrderPerformanceTab } from './components/order-performance-tab'
import { TaskProductivityTab } from './components/task-productivity-tab'

/**
 * These specs assert the two things the previous suite never checked:
 *
 * 1. Ratio display. The old test was named "renders ... exact percentage badges
 *    with counts" but asserted only labels, a name and a currency figure. Every
 *    `({row.confirmed} / {row.ordersHandled})` span could be deleted and it
 *    would still have passed.
 * 2. Date presets. They used toISOString(), i.e. the browser's UTC day, which is
 *    yesterday between 00:00 and 06:00 Dhaka — six hours a day of wrong data.
 */

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn((url: string) => {
      if (url.includes('/hr/performance/orders')) {
        return Promise.resolve({
          data: {
            summary: {
              totalOrdersHandled: 100,
              totalConfirmed: 80,
              overallConfirmationRate: 80,
              totalDelivered: 60,
              overallDeliveryRate: 75,
              overallEndToEndDeliveryRate: 60,
              totalReturned: 6,
              overallReturnRate: 10,
              totalCancelled: 10,
              overallCancellationRate: 10,
              totalRevenue: 120000,
            },
            data: [
              {
                employeeId: 'emp-1',
                employeeCode: 'EMP-001',
                name: 'Rahim Khan',
                email: 'rahim@ecomate.com',
                department: 'Sales & Operations',
                designation: 'Order Specialist',
                avatar: null,
                ordersHandled: 100,
                confirmed: 80,
                confirmationRate: 80,
                delivered: 60,
                deliveryRate: 75,
                endToEndDeliveryRate: 60,
                returned: 6,
                returnRate: 10,
                cancelled: 10,
                cancellationRate: 10,
                totalRevenue: 120000,
              },
            ],
            meta: {
              total: 1,
              page: 1,
              perPage: 15,
              totalPages: 1,
              from: '2026-10-01',
              to: '2026-10-02',
            },
          },
        })
      }
      if (url.includes('/hr/performance/tasks')) {
        return Promise.resolve({
          data: {
            data: [
              {
                employeeId: 'emp-1',
                employeeCode: 'EMP-001',
                name: 'Rahim Khan',
                email: 'rahim@ecomate.com',
                department: 'Sales & Operations',
                designation: 'Order Specialist',
                avatar: null,
                assigned: 15,
                completed: 12,
                pending: 3,
                completionRate: 80,
                timeSpentMinutes: 360,
                timeSpentDisplay: '6h 0m',
                avgTaskDurationMinutes: 30,
                avgTaskDurationDisplay: '30m avg',
              },
            ],
            // Totals across the WHOLE result set, not the returned page.
            summary: {
              totalEmployees: 4,
              totalAssigned: 60,
              totalCompleted: 48,
              totalPending: 12,
              totalTimeSpentMinutes: 1440,
              completionRate: 80,
            },
            meta: {
              total: 4,
              page: 1,
              perPage: 15,
              totalPages: 1,
              from: '2026-10-01',
              to: '2026-10-02',
              dateSemantics: {},
            },
          },
        })
      }
      return Promise.resolve({ data: [] })
    }),
    // The backend returns {scanned, inserted}; the client previously typed this
    // as {count, message}, so the toast rendered "Backfilled undefined events".
    post: vi.fn(() =>
      Promise.resolve({ data: { scanned: 42, inserted: 17, lastOrderId: 'x', hasMore: false } }),
    ),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
})

describe('OrderPerformanceTab', () => {
  it('renders funnel summary cards with the employee row', async () => {
    renderWithClient(<OrderPerformanceTab />)

    expect(screen.getByText('Orders Handled')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Rahim Khan')).toBeInTheDocument()
    })

    expect(screen.getByText(/EMP-001/)).toBeInTheDocument()
    expect(screen.getByText('৳120,000')).toBeInTheDocument()
  })

  // The spec requires "82% (410 / 500)" rather than a bare percentage, so a
  // reader can see the size of the cohort behind every rate.
  it('renders numerator and denominator for every per-row rate', async () => {
    renderWithClient(<OrderPerformanceTab />)

    await waitFor(() => {
      expect(screen.getByText('Rahim Khan')).toBeInTheDocument()
    })

    expect(screen.getByText('(80 / 100)')).toBeInTheDocument() // confirmation rate
    expect(screen.getByText('(60 / 80)')).toBeInTheDocument() // delivery from confirmed
    expect(screen.getByText('(6 / 60)')).toBeInTheDocument() // return from delivered
    expect(screen.getByText('(10 / 100)')).toBeInTheDocument() // cancellation from handled
  })

  it('renders the cohort counts on the summary KPI cards', async () => {
    renderWithClient(<OrderPerformanceTab />)

    await waitFor(() => {
      expect(screen.getByText('Rahim Khan')).toBeInTheDocument()
    })

    expect(screen.getAllByText(/80 \/ 100/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/60 \/ 80/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/6 \/ 60/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/10 \/ 100/).length).toBeGreaterThan(0)
  })
})

describe('TaskProductivityTab', () => {
  it('renders employee task productivity with completion % and duration', async () => {
    renderWithClient(<TaskProductivityTab />)

    await waitFor(() => {
      expect(screen.getByText('Rahim Khan')).toBeInTheDocument()
    })

    expect(screen.getAllByText('6h 0m').length).toBeGreaterThan(0)
    expect(screen.getByText('30m avg')).toBeInTheDocument()
  })

  // The headline completion rate used to be summed from the returned page, so
  // it changed when paging. It must come from the server summary.
  it('uses the server-wide summary, not a sum of the current page', async () => {
    renderWithClient(<TaskProductivityTab />)

    await waitFor(() => {
      expect(screen.getByText('Rahim Khan')).toBeInTheDocument()
    })

    // Server summary says 48/60 — the page alone only has 12/15.
    expect(screen.getByText('48 / 60 completed')).toBeInTheDocument()
    expect(screen.queryByText('12 / 15 completed')).not.toBeInTheDocument()
  })

  it('shows the per-row completion counts', async () => {
    renderWithClient(<TaskProductivityTab />)

    await waitFor(() => {
      expect(screen.getByText('Rahim Khan')).toBeInTheDocument()
    })

    expect(screen.getByText('(12/15)')).toBeInTheDocument()
  })
})

describe('Backfill response contract', () => {
  it('matches the backend payload shape', async () => {
    const { hrPerformanceApi } = await import('./api')
    await expect(hrPerformanceApi.backfillOrderEvents()).resolves.toEqual({
      scanned: 42,
      inserted: 17,
      lastOrderId: 'x',
      hasMore: false,
    })
  })
})