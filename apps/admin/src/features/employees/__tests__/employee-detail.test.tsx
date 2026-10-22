import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { EmployeeDetailPage } from '../components/employee-detail'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'emp-1' }),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

const EMPLOYEE = {
  id: 'emp-1',
  employeeId: 'EMP-0001',
  employmentType: 'full_time',
  status: 'active',
  joiningDate: '2024-01-15T00:00:00.000Z',
  attendanceMethod: 'APP',
  betterAuthUser: { id: 'u1', name: 'John Doe', email: 'john@ecomate.com', role: 'employee' },
  department: { id: 'dept-1', name: 'Engineering', slug: 'engineering' },
  designation: null,
  accessPreset: null,
}

function mockRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/employees/emp-1') {
      return Promise.resolve({ data: EMPLOYEE })
    }
    if (url === '/employees/emp-1/schedule') {
      return Promise.resolve({ data: { days: [5, 6], note: null } })
    }
    if (url === '/departments') {
      return Promise.resolve({ data: { data: [], meta: { total: 0 } } })
    }
    if (url === '/designations') {
      return Promise.resolve({ data: [] })
    }
    if (url === '/employees/emp-1/bank-accounts') {
      // Must be a bare array: the detail page calls .map() on it directly.
      return Promise.resolve({ data: [] })
    }
    if (url === '/employees/emp-1/salary-structure') {
      return Promise.resolve({ data: null })
    }
    if (url === '/employees/emp-1/leave-balances') {
      return Promise.resolve({ data: [] })
    }
    if (url === '/hr/shifts/employees/emp-1/rotation') {
      return Promise.resolve({ data: { employeeId: 'emp-1', rotation: [] } })
    }
    if (url === '/hr/attendance/today') {
      return Promise.resolve({
        data: { state: 'none', workedMinutes: 0, breakMinutes: 0 },
      })
    }
    if (url === '/employees') {
      return Promise.resolve({
        data: { data: [EMPLOYEE], meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } },
      })
    }
    return Promise.resolve({ data: { data: [], meta: { total: 0 } } })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/**
 * Regression guard for "Rendered more hooks than during the previous render".
 *
 * Five hooks (shift rotation, leave balances, today state, salary structure and
 * the full-edit dialog state) used to sit BELOW the loading and error early
 * returns. On a cold navigation the first render returned early and ran 14
 * hooks; once the employee query resolved the component ran 20 and React threw,
 * so the page showed a 500. It only reproduced on the first click after a
 * browser reload because a cached query skips the loading branch entirely.
 *
 * Every hook must now be above the early returns, so the count is constant.
 */
describe('EmployeeDetailPage — hook ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoutes()
  })

  it('survives the loading → loaded transition without a hook-count error', async () => {
    // Render while the query is in flight, then let it resolve, exactly like a
    // cold navigation from the employee list.
    const { getByText } = await wrap(<EmployeeDetailPage employeeId='emp-1' />)

    // The loading skeleton must render first (that is the branch that used to
    // return before the extra hooks).
    expect(document.body.textContent).not.toContain('Something went wrong')

    await vi.waitFor(
      () => {
        expect(mockGet.mock.calls.some(([u]: [string]) => u === '/employees/emp-1')).toBe(true)
      },
      { timeout: 2000, interval: 50 },
    )

    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain('EMP-0001')
      },
      { timeout: 3000, interval: 50 },
    )

    // The loaded branch must render normally, with no React hook violation.
    expect(document.body.textContent).not.toMatch(/more hooks than during/i)
    await expect.element(getByText('EMP-0001')).toBeInTheDocument()
  })
})

/**
 * Part 3 — HR dates rendered one day early. The fixture stores joiningDate as
 * the UTC-midnight instant for Jan 15, so the Overview must show Jan 15 — never
 * the host-rolled-back Jan 14. This is the render half of the fix; the Net
 * Compensation figure is owned by a different change and is not asserted here.
 */
describe('EmployeeDetailPage — Overview dates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoutes()
  })

  it('renders the joining date as its Dhaka calendar day', async () => {
    await wrap(<EmployeeDetailPage employeeId='emp-1' />)

    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain('Jan 15, 2024')
      },
      { timeout: 3000, interval: 50 },
    )

    expect(document.body.textContent).not.toContain('Jan 14, 2024')
  })
})