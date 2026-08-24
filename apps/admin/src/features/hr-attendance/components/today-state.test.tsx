import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { useState } from 'react'
import { TodayState } from './today-state'

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
  {
    id: 'emp-2',
    employeeId: 'EMP-002',
    employeeName: 'Jane Roe',
    betterAuthUser: { id: 'u2', name: 'Jane Roe', email: 'jane@ecomate.com', role: 'employee' },
    department: null,
    designation: null,
    status: 'active',
    attendanceMethod: 'MACHINE',
  },
]

let todayState: Record<string, unknown> = { state: 'before_work', workedMinutes: 0, breakMinutes: 0 }
let historyDays: unknown[] = []

function mockGetRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/employees') {
      return Promise.resolve({ data: { data: EMPLOYEES, meta: { total: 2, page: 1, perPage: 100, totalPages: 1 } } })
    }
    if (url === '/hr/attendance/today') {
      return Promise.resolve({ data: todayState })
    }
    if (url === '/hr/attendance/history') {
      return Promise.resolve({ data: historyDays })
    }
    return Promise.resolve({ data: {} })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function StatefulTodayState() {
  const [employeeId, setEmployeeId] = useState('')
  return <TodayState employeeId={employeeId} onEmployeeIdChange={setEmployeeId} />
}

async function selectEmployee(screen: any) {
  await screen.getByRole('combobox').click()
  await screen.getByRole('option', { name: /EMP-001 · John Doe/i }).click()
}

describe('TodayState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    todayState = { state: 'before_work', workedMinutes: 0, breakMinutes: 0 }
    historyDays = []
    mockGetRoutes()
  })

  it('prompts for an employee when none is selected', async () => {
    const { getByText } = await wrap(<TodayState employeeId='' onEmployeeIdChange={() => {}} />)

    await expect
      .element(getByText(/Select an employee to view today's attendance state/i))
      .toBeInTheDocument()
  })

  it('renders before_work state with a Check In button and calls POST on click', async () => {
    const { getByRole, getByText } = await wrap(<StatefulTodayState />)

    await selectEmployee({ getByText, getByRole })

    await expect.element(getByText('Not Checked In')).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: /Check In/i }))

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/hr/attendance/check-in', { employeeId: 'emp-1' })
    })
    expect(mockGet).toHaveBeenCalledWith(
      '/hr/attendance/today',
      expect.objectContaining({ params: expect.objectContaining({ employeeId: 'emp-1' }) }),
    )
  })

  it('renders working state with Working since time plus Start Break and Check Out buttons', async () => {
    todayState = {
      state: 'working',
      checkInAt: '2026-08-23T03:02:00.000Z',
      workedMinutes: 125,
      breakMinutes: 12,
    }
    const { getByRole, getByText } = await wrap(<TodayState employeeId='emp-1' onEmployeeIdChange={() => {}} />)

    await expect.element(getByText(/Working/i)).toBeInTheDocument()
    await expect.element(getByText(/Since/i)).toBeInTheDocument()
    await expect.element(getByRole('button', { name: /Start Break/i })).toBeInTheDocument()
    await expect.element(getByRole('button', { name: /Check Out/i })).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: /Start Break/i }))

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/hr/attendance/break/start', { employeeId: 'emp-1' })
    })
  })

  it('renders on_break state with End Break button and calls POST on click', async () => {
    todayState = { state: 'on_break', checkInAt: '2026-08-23T03:02:00.000Z', workedMinutes: 40, breakMinutes: 18 }
    const { getByRole, getByText } = await wrap(<TodayState employeeId='emp-1' onEmployeeIdChange={() => {}} />)

    await expect.element(getByText('On Break')).toBeInTheDocument()
    await expect.element(getByText(/18m/)).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: /End Break/i }))

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/hr/attendance/break/end', { employeeId: 'emp-1' })
    })
  })

  it('renders checked_out state with durations and day status badge', async () => {
    todayState = {
      state: 'checked_out',
      checkInAt: '2026-08-23T03:02:00.000Z',
      checkOutAt: '2026-08-23T12:44:00.000Z',
      workedMinutes: 462,
      breakMinutes: 45,
    }
    historyDays = [
      {
        id: 'day-1',
        employeeId: 'emp-1',
        date: '2026-08-23T00:00:00.000Z',
        status: 'LATE',
        workedMinutes: 462,
        breakMinutes: 45,
      },
    ]
    const { getByText } = await wrap(<TodayState employeeId='emp-1' onEmployeeIdChange={() => {}} />)

    await expect.element(getByText('Checked Out')).toBeInTheDocument()
    await expect.element(getByText(/7h 42m/)).toBeInTheDocument()
    await expect.element(getByText('Late')).toBeInTheDocument()
  })

  it('shows the attendance method chip for the selected employee', async () => {
    const { getByRole, getByText } = await wrap(<StatefulTodayState />)

    await getByRole('combobox').click()
    await getByRole('option', { name: /EMP-002 · Jane Roe/i }).click()

    await expect.element(getByText('Machine attendance')).toBeInTheDocument()
  })

  it('shows MISSING CHECKOUT badge + Close Session action for an open-session day', async () => {
    todayState = {
      state: 'working',
      checkInAt: '2026-08-23T03:02:00.000Z',
      workedMinutes: 125,
      breakMinutes: 12,
      missingCheckout: true,
    }
    historyDays = [
      {
        id: 'day-1',
        employeeId: 'emp-1',
        date: '2026-08-23T00:00:00.000Z',
        status: 'PRESENT',
        workedMinutes: 125,
        breakMinutes: 12,
        missingCheckout: true,
      },
    ]
    const { getByRole, getByText } = await wrap(<StatefulTodayState />)

    await selectEmployee({ getByText, getByRole })

    await expect.element(getByText('MISSING CHECKOUT')).toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: /Close Session/i }))
    await expect.element(getByRole('textbox')).toBeInTheDocument()
  })

  it('posts /hr/attendance/close-session with the reason when confirmed', async () => {
    todayState = {
      state: 'working',
      checkInAt: '2026-08-23T03:02:00.000Z',
      workedMinutes: 125,
      breakMinutes: 12,
      missingCheckout: true,
    }
    historyDays = [
      {
        id: 'day-1',
        employeeId: 'emp-1',
        date: '2026-08-23T00:00:00.000Z',
        status: 'PRESENT',
        workedMinutes: 125,
        breakMinutes: 12,
        missingCheckout: true,
      },
    ]
    const { getByRole, getByText } = await wrap(<StatefulTodayState />)

    await selectEmployee({ getByText, getByRole })
    await userEvent.click(getByRole('button', { name: /Close Session/i }))

    await userEvent.type(getByRole('textbox'), 'Missed logout')
    await userEvent.click(getByRole('button', { name: /Confirm Close/i }))

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/hr/attendance/close-session', {
        dayId: 'day-1',
        reason: 'Missed logout',
      })
    })
  })
})