import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { Employees } from '../index'

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
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const EMPLOYEES = [
  { id: 'emp-1', employeeId: 'EMP-0001', employmentType: 'full_time', status: 'active', salary: 50000, attendanceMethod: 'APP', betterAuthUser: { id: 'u1', name: 'John Doe', email: 'john@ecomate.com', role: 'employee' }, department: { id: 'dept-1', name: 'Engineering', slug: 'engineering' }, designation: null, accessPreset: null },
]

const EMPTY_LIST = { data: [], meta: { total: 0, page: 1, perPage: 10, totalPages: 0 } }

function mockGetRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/employees') {
      return Promise.resolve({ data: { data: EMPLOYEES, meta: { total: 1, page: 1, perPage: 10, totalPages: 1 } } })
    }
    if (url === '/designations') {
      return Promise.resolve({ data: [{ id: 'desig-1', name: 'Developer', slug: 'developer', level: 1 }] })
    }
    if (url === '/departments') {
      return Promise.resolve({ data: { data: [{ id: 'dept-1', name: 'Engineering', slug: 'engineering' }], meta: { total: 1 } } })
    }
    return Promise.resolve({ data: EMPTY_LIST })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('Employees — G-06 server-side list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRoutes()
  })

  it('renders the employee rows with name from the BA user', async () => {
    const { getByText } = await wrap(<Employees />)
    await expect.element(getByText('John Doe')).toBeInTheDocument()
    await expect.element(getByText('EMP-0001')).toBeInTheDocument()
  })

  it('sends a debounced search param to the API', async () => {
    await wrap(<Employees />)
    const input = document.querySelector('input')!
    await userEvent.type(input, 'jane')

    await vi.waitFor(
      () => {
        const calls = mockGet.mock.calls.filter(([url]: [string]) => url === '/employees')
        const serialized = calls.map(([, c]: [string, any]) => JSON.stringify(c?.params))
        expect(serialized.some((s) => s && s.includes('"search":"jane"'))).toBe(true)
      },
      { timeout: 2000, interval: 100 },
    )
  })

  it('resets to page 1 and refetches when perPage changes', async () => {
    await wrap(<Employees />)

    const combos = Array.from(document.querySelectorAll('[role="combobox"]'))
    const perPageTrigger = combos.find((c) => c.textContent === '10 / page')
    expect(perPageTrigger).toBeDefined()
    perPageTrigger!.click()

    await vi.waitFor(() => {
      const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent === '25 / page')
      expect(option).toBeDefined()
    })
    Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent === '25 / page')!.click()

    await vi.waitFor(
      () => {
        const calls = mockGet.mock.calls.filter(([url]: [string]) => url === '/employees')
        const withPerPage = calls.find(([, c]: [string, any]) => c?.params?.perPage === 25)
        expect(withPerPage).toBeDefined()
      },
      { timeout: 2000, interval: 100 },
    )
  })
})
