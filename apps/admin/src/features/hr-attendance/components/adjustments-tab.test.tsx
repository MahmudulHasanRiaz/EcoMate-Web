import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { AdjustmentsTab } from './adjustments-tab'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const EMPLOYEES = [
  {
    id: 'emp-1',
    employeeId: 'EMP-001',
    employeeName: 'John Doe',
    betterAuthUser: { id: 'u1', name: 'John Doe', email: 'john@ecomate.com', role: 'employee' },
    department: null,
    designation: null,
    status: 'active',
    attendanceMethod: 'APP',
  },
]

const DAY = {
  id: 'day-1',
  employeeId: 'emp-1',
  date: '2026-08-23T00:00:00.000Z',
  status: 'PRESENT',
  workedMinutes: 300,
  breakMinutes: 30,
  employee: {
    employeeId: 'EMP-001',
    status: 'active',
    department: null,
    designation: null,
    betterAuthUser: { name: 'John Doe' },
  },
}

function mockGetRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/employees') {
      return Promise.resolve({ data: { data: EMPLOYEES, meta: { total: 1, page: 1, perPage: 100, totalPages: 1 } } })
    }
    if (url === '/hr/attendance/adjustments') {
      return Promise.resolve({
        data: {
          data: [
            {
              id: 'adj-1',
              employeeId: 'emp-1',
              dayId: 'day-1',
              field: 'workedMinutes',
              originalValue: '300',
              correctedValue: '330',
              reason: 'Forgot checkout',
              adjustedAt: '2026-08-23T05:00:00.000Z',
              employee: { employeeId: 'EMP-001', betterAuthUser: { name: 'John Doe' } },
            },
          ],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        },
      })
    }
    if (url === '/hr/attendance/history') {
      return Promise.resolve({ data: [DAY] })
    }
    return Promise.resolve({ data: {} })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('AdjustmentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRoutes()
  })

  it('renders the adjustment list with employee, field, reason', async () => {
    const { getByText } = await wrap(<AdjustmentsTab />)

    await expect.element(getByText('Forgot checkout')).toBeInTheDocument()
    await expect.element(getByText('workedMinutes')).toBeInTheDocument()
    await expect.element(getByText('EMP-001 · John Doe')).toBeInTheDocument()
  })

  it('POSTs an adjustment with resolved dayId when employee+date have a day', async () => {
    const { getByRole, getByText, getByPlaceholder } = await wrap(<AdjustmentsTab />)

    await userEvent.click(getByRole('button', { name: /Add Adjustment/i }))
    await expect.element(getByRole('heading', { name: 'Add Adjustment' })).toBeInTheDocument()

    await getByRole('combobox').first().click()
    await getByRole('option', { name: /EMP-001 · John Doe/i }).click()

    await getByRole('combobox').filter({ hasText: 'Status' }).click()
    await getByRole('option', { name: /Worked minutes/i }).click()

    await userEvent.fill(getByRole('spinbutton'), '330')

    await userEvent.fill(
      getByPlaceholder('Why is this day being adjusted?'),
      'Forgot to checkout',
    )

    await userEvent.click(getByRole('button', { name: /Save Adjustment/i }))

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/hr/attendance/adjustments', {
        employeeId: 'emp-1',
        dayId: 'day-1',
        field: 'workedMinutes',
        correctedValue: '330',
        reason: 'Forgot to checkout',
      })
    })
  })

  it('requires a reason — save without one POSTs nothing and highlights the field', async () => {
    const { getByRole, getByText } = await wrap(<AdjustmentsTab />)

    await userEvent.click(getByRole('button', { name: /Add Adjustment/i }))
    await expect.element(getByRole('heading', { name: 'Add Adjustment' })).toBeInTheDocument()

    await getByRole('combobox').first().click()
    await getByRole('option', { name: /EMP-001 · John Doe/i }).click()

    await userEvent.click(getByRole('button', { name: /Save Adjustment/i }))

    await expect.element(getByText('Reason is required.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalledWith('/hr/attendance/adjustments', expect.anything())
  })

  it('warns when no attendance day exists for the selection before POSTing', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/employees') {
        return Promise.resolve({ data: { data: EMPLOYEES, meta: { total: 1, page: 1, perPage: 100, totalPages: 1 } } })
      }
      if (url === '/hr/attendance/adjustments') {
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } } })
      }
      if (url === '/hr/attendance/history') {
        return Promise.resolve({ data: [] })
      }
      return Promise.resolve({ data: {} })
    })
    const { getByRole, getByText } = await wrap(<AdjustmentsTab />)

    await userEvent.click(getByRole('button', { name: /Add Adjustment/i }))
    await getByRole('combobox').first().click()
    await getByRole('option', { name: /EMP-001 · John Doe/i }).click()

    await expect.element(getByText('No attendance day for this date.')).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: /Save Adjustment/i }))

    await vi.waitFor(() => {
      expect(mockPost).not.toHaveBeenCalledWith('/hr/attendance/adjustments', expect.anything())
    })
  })
})