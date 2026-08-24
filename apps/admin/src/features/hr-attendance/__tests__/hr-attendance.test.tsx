import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
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
vi.mock('sonner', () => ({ toast }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

const authPermissions = vi.hoisted(() => ({
  value: ['manage_attendance', 'manage_attendance_devices', 'manage_hr_settings'],
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({
      auth: {
        user: {
          id: 'u1',
          email: 'admin@ecomate.com',
          role: 'admin',
          permissions: authPermissions.value,
        },
      },
    }),
}))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockPatch = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, patch: mockPatch, put: vi.fn(), delete: mockDelete },
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
    if (url === '/hr/attendance/today') {
      return Promise.resolve({ data: { state: 'before_work', workedMinutes: 0, breakMinutes: 0 } })
    }
    if (url === '/hr/attendance/history') {
      return Promise.resolve({ data: [] })
    }
    if (url === '/hr/attendance/adjustments') {
      return Promise.resolve({ data: EMPTY_LIST })
    }
    if (url === '/hr/attendance/devices') {
      return Promise.resolve({
        data: [{ id: 'dev-1', name: 'Main Scanner', deviceType: 'FINGERPRINT', enabled: true, syncStatus: 'IDLE', lastSyncAt: null, host: '192.168.1.50', port: 4370, location: 'Gate', vendor: null }],
      })
    }
    if (url === '/hr/attendance/settings') {
      return Promise.resolve({ data: { id: 'global', mode: 'APP' } })
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
    authPermissions.value = ['manage_attendance', 'manage_attendance_devices', 'manage_hr_settings']
    mockGetRoutes()
  })

  it('renders the sub-tabs Today, Calendar, Adjustments, Devices, Settings', async () => {
    const { getByRole } = await wrap(<AttendancePage />)

    await expect.element(getByRole('tab', { name: 'Today' })).toBeInTheDocument()
    await expect.element(getByRole('tab', { name: 'Calendar' })).toBeInTheDocument()
    await expect.element(getByRole('tab', { name: 'Adjustments' })).toBeInTheDocument()
    await expect.element(getByRole('tab', { name: 'Devices' })).toBeInTheDocument()
    await expect.element(getByRole('tab', { name: 'Settings' })).toBeInTheDocument()
  })

  it('shows the Today state card by default (employee prompt)', async () => {
    const { getByText } = await wrap(<AttendancePage />)

    await expect
      .element(getByText(/Select an employee to view today's attendance state/i))
      .toBeInTheDocument()
  })

  it('shows devices table when the Devices tab is opened with permission', async () => {
    const { getByRole, getByText } = await wrap(<AttendancePage />)

    await userEvent.click(getByRole('tab', { name: 'Devices' }))

    await expect.element(getByText('Main Scanner')).toBeInTheDocument()
    await expect.element(getByText('IDLE')).toBeInTheDocument()
  })

  it('shows the permission gate instead of devices when permission is missing', async () => {
    authPermissions.value = ['manage_attendance']
    const { getByRole, getByText } = await wrap(<AttendancePage />)

    await userEvent.click(getByRole('tab', { name: 'Devices' }))

    await expect
      .element(getByText('Devices require Manage Attendance Devices permission.'))
      .toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalledWith('/hr/attendance/devices', expect.anything())
  })

  it('shows the calendar with filters and empty state when Calendar tab is opened', async () => {
    const { getByRole, getByText } = await wrap(<AttendancePage />)

    await userEvent.click(getByRole('tab', { name: 'Calendar' }))

    await expect.element(getByText('Employee (optional)')).toBeInTheDocument()
    await expect
      .element(getByText('No attendance records for this date/filter.'))
      .toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/hr/attendance', expect.anything())
  })

  it('shows the adjustment list with an Add Adjustment action in the Adjustments tab', async () => {
    const { getByRole, getByText } = await wrap(<AttendancePage />)

    await userEvent.click(getByRole('tab', { name: 'Adjustments' }))

    await expect.element(getByText('Audit-trailed corrections to attendance days')).toBeInTheDocument()
    await expect.element(getByRole('button', { name: /Add Adjustment/i })).toBeInTheDocument()
  })

  it('labels a MISSING CHECKOUT row in the calendar and offers Close Session', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/hr/attendance') {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'day-1',
                employeeId: 'emp-1',
                date: '2026-08-23T00:00:00.000Z',
                status: 'PRESENT',
                workedMinutes: 480,
                breakMinutes: 30,
                missingCheckout: true,
                employee: { employeeId: 'EMP-001', betterAuthUser: { name: 'John Doe' } },
                sessions: [{ checkOutAt: null }],
              },
            ],
            meta: { total: 1, page: 1, perPage: 20, totalPages: 0 },
          },
        })
      }
      if (url === '/hr/attendance/daily-overview') {
        return Promise.resolve({ data: { date: '2026-08-23', total: 0, counts: EMPTY_COUNTS } })
      }
      return Promise.resolve({ data: {} })
    })

    const { getByRole, getByText } = await wrap(<AttendancePage />)
    await userEvent.click(getByRole('tab', { name: 'Calendar' }))

    await expect.element(getByText('MISSING CHECKOUT')).toBeInTheDocument()
    await expect.element(getByRole('button', { name: /Close Session/i })).toBeInTheDocument()
  })

  describe('Add Day (G-03 UI)', () => {
    beforeEach(() => {
      authPermissions.value = [
        'manage_attendance',
        'manage_attendance_devices',
        'manage_hr_settings',
        'manage_attendance_adjustments',
      ]
    })

    it('renders an enabled Add Day action with permission and opens the dialog with fields', async () => {
      const { getByRole, getByText } = await wrap(<AttendancePage />)

      const addBtn = getByRole('button', { name: /Add Day/i })
      await expect.element(addBtn).toBeInTheDocument()
      await expect.element(addBtn).toBeEnabled()

      await userEvent.click(addBtn)

      await expect.element(getByText('Add Manual Day')).toBeInTheDocument()
      await expect.element(getByRole('combobox', { name: /Employee/i })).toBeInTheDocument()

      await getByRole('combobox', { name: /Employee/i }).click()
      await vi.waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith(
          '/employees',
          expect.objectContaining({
            params: expect.objectContaining({ perPage: 50 }),
          }),
        )
      })
      await expect.element(getByRole('button', { name: /EMP-001 · John Doe/i })).toBeInTheDocument()
    })

    it('disables the Add Day action and shows the hint when the adjustments permission is missing', async () => {
      authPermissions.value = ['manage_attendance']
      const { getByRole, getByText } = await wrap(<AttendancePage />)

      await expect.element(getByRole('button', { name: /Add Day/i })).toBeDisabled()
      await expect
        .element(
          getByText('Requires Manage Attendance Adjustments permission.'),
        )
        .toBeInTheDocument()
    })

    it('posts /hr/attendance/days with employee, date, status and reason on save', async () => {
      const { getByRole, getByText } = await wrap(<AttendancePage />)
      await userEvent.click(getByRole('button', { name: /Add Day/i }))

      await getByRole('combobox', { name: /Employee/i }).click()
      await getByRole('button', { name: /EMP-001 · John Doe/i }).click()

      await userEvent.type(
        getByRole('textbox', { name: /Reason/i }),
        'Absent due to emergency',
      )
      await userEvent.click(getByRole('button', { name: /Save Day/i }))

      await vi.waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/hr/attendance/days', {
          employeeId: 'emp-1',
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          status: 'ABSENT',
          reason: 'Absent due to emergency',
        })
      })
    })

    it('keeps the dialog open and surfaces the server 409 duplicate-day message', async () => {
      mockPost.mockImplementation((url: string) => {
        if (url === '/hr/attendance/days') {
          return Promise.reject({
            response: {
              status: 409,
              data: { message: 'An attendance day already exists for this date' },
            },
          })
        }
        return Promise.resolve({ data: {} })
      })

      const { getByRole, getByText } = await wrap(<AttendancePage />)
      await userEvent.click(getByRole('button', { name: /Add Day/i }))
      await getByRole('combobox', { name: /Employee/i }).click()
      await getByRole('button', { name: /EMP-001 · John Doe/i }).click()
      await userEvent.type(getByRole('textbox', { name: /Reason/i }), 'Duplicate')
      await userEvent.click(getByRole('button', { name: /Save Day/i }))

      await vi.waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'An attendance day already exists for this date',
        )
      })
      await expect.element(getByText('Add Manual Day')).toBeInTheDocument()
    })
  })
})