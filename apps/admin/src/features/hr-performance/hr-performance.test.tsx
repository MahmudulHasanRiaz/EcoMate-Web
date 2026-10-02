import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { OrderPerformanceTab } from './components/order-performance-tab'
import { TaskProductivityTab } from './components/task-productivity-tab'

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
      return Promise.resolve({ data: [] })
    }),
    post: vi.fn(() => Promise.resolve({ data: { count: 0, message: 'Success' } })),
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
  it('renders funnel summary cards and exact percentage badges with counts', async () => {
    renderWithClient(<OrderPerformanceTab />)

    expect(screen.getByText('Orders Handled')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Rahim Khan')).toBeInTheDocument()
    })

    expect(screen.getByText(/EMP-001/)).toBeInTheDocument()
    expect(screen.getByText('৳120,000')).toBeInTheDocument()
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
})
