import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { toast } from 'sonner'
import { AttendancePage } from '../index'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({ Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockPatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, patch: mockPatch, put: vi.fn(), delete: vi.fn() },
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
  },
]

const EMPTY_LIST = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
const EMPTY_COUNTS = {
  PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, ON_LEAVE: 0, WEEKLY_OFF: 0,
}

function mockGetRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/hr/attendance/daily-overview') {
      return Promise.resolve({ data: { date: '2026-08-23', total: 0, counts: EMPTY_COUNTS } })
    }
    if (url === '/hr/attendance') {
      return Promise.resolve({ data: EMPTY_LIST })
    }
    if (url === '/employees') {
      return Promise.resolve({ data: { data: EMPLOYEES, meta: { total: 1, page: 1, perPage: 100, totalPages: 1 } } })
    }
    if (url === '/departments') {
      return Promise.resolve({ data: EMPTY_LIST })
    }
    return Promise.resolve({ data: {} })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('AttendancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRoutes()
  })

  it('renders the filter row and default date', async () => {
    const { getByText, getByRole } = await wrap(<AttendancePage />)

    await expect.element(getByText('Employee (optional)')).toBeInTheDocument()
    await expect.element(getByText('Status (optional)')).toBeInTheDocument()
    await expect.element(getByText('Department (optional)')).toBeInTheDocument()
    await expect.element(getByText('All statuses')).toBeInTheDocument()
    await expect.element(getByText('All employees')).toBeInTheDocument()
    await expect.element(getByRole('button', { name: /Add Record/i })).toBeInTheDocument()
  })

  it('shows empty state when no records match the filters', async () => {
    const { getByText } = await wrap(<AttendancePage />)

    await expect
      .element(getByText('No attendance records for this date/filter.'))
      .toBeInTheDocument()
  })

  it('toasts success when a record is created', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        id: 'att-1',
        employeeId: 'emp-1',
        date: '2026-08-23T00:00:00.000Z',
        status: 'PRESENT',
        checkInTime: null,
        checkOutTime: null,
        note: null,
        employee: EMPLOYEES[0],
      },
    })

    const { getByRole, getByText } = await wrap(<AttendancePage />)

    await expect.element(getByRole('button', { name: /Add Record/i })).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: /Add Record/i }))

    await expect.element(getByRole('heading', { name: /Add Attendance Record/i })).toBeInTheDocument()

    const employeeTrigger = getByText('Select employee')
    await expect.element(employeeTrigger).toBeInTheDocument()
    await userEvent.click(employeeTrigger)
    await userEvent.click(getByRole('option', { name: /EMP-001 · John Doe/i }))

    await userEvent.click(getByRole('button', { name: /Create Record/i }))

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Attendance record created')
    })
    expect(mockPost).toHaveBeenCalledWith(
      '/hr/attendance',
      expect.objectContaining({ employeeId: 'emp-1', status: 'PRESENT' }),
    )
  })

  it('shows the server conflict message (not a raw object) when creation fails with 409', async () => {
    mockPost.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'Attendance record already exists for this employee on this date' } },
    })

    const { getByRole, getByText } = await wrap(<AttendancePage />)

    await expect.element(getByRole('button', { name: /Add Record/i })).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: /Add Record/i }))

    await expect.element(getByRole('heading', { name: /Add Attendance Record/i })).toBeInTheDocument()

    const employeeTrigger = getByText('Select employee')
    await expect.element(employeeTrigger).toBeInTheDocument()
    await userEvent.click(employeeTrigger)
    await userEvent.click(getByRole('option', { name: /EMP-001 · John Doe/i }))

    await userEvent.click(getByRole('button', { name: /Create Record/i }))

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1)
    })
    expect(toast.error).toHaveBeenCalledWith(
      'Attendance record already exists for this employee on this date',
    )
  })

  it('shows a friendly error with Retry (not an empty table) when the list request fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/hr/attendance/daily-overview') {
        return Promise.resolve({ data: { date: '2026-08-23', total: 0, counts: EMPTY_COUNTS } })
      }
      if (url === '/hr/attendance') {
        return Promise.reject({ response: { status: 403, data: { message: 'Forbidden' } } })
      }
      if (url === '/employees') {
        return Promise.resolve({ data: { data: EMPLOYEES, meta: { total: 1, page: 1, perPage: 100, totalPages: 1 } } })
      }
      if (url === '/departments') {
        return Promise.resolve({ data: EMPTY_LIST })
      }
      return Promise.resolve({ data: {} })
    })

    const { getByText, getByRole } = await wrap(<AttendancePage />)

    await expect
      .element(getByText('Could not load attendance records.'))
      .toBeInTheDocument()
    await expect.element(getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/hr/attendance', expect.anything())
  })
})