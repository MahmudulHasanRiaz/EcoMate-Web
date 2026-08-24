import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import CreateEmployeePage from '../create'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({ Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Reduce popover/calendar complexity in the browser test: the stub commits a
// fixed date on click, exactly what the step flow needs.
vi.mock('@/components/date-picker', () => ({
  DatePicker: ({ onSelect }:
    { onSelect: (d?: Date) => void; selected?: Date; placeholder?: string }) => (
    <button onClick={() => onSelect(new Date('2026-01-15'))}>FakeDate</button>
  ),
}))

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: () => null,
}))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

function mockGetRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/employees') {
      return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, perPage: 100, totalPages: 0 } } })
    }
    if (url === '/designations') {
      return Promise.resolve({ data: [{ id: 'desig-1', name: 'Developer', slug: 'developer', level: 1 }] })
    }
    if (url === '/access-presets') {
      return Promise.resolve({ data: { data: [{ id: 'preset-1', name: 'Staff' }], meta: {} } })
    }
    if (url === '/departments') {
      return Promise.resolve({ data: { data: [{ id: 'dept-1', name: 'Engineering', slug: 'engineering' }], meta: {} } })
    }
    if (url === '/employees/search/ba-users') {
      return Promise.resolve({ data: { data: [{ id: 'u1', name: 'John Doe', email: 'john@ecomate.com', role: 'employee' }] } })
    }
    return Promise.resolve({ data: {} })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CreateEmployeePage — G-15 nested create flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRoutes()
    mockPost.mockResolvedValue({ data: { id: 'new-1', employeeId: 'EMP-260115-0001', betterAuthUser: { name: 'John Doe' } } })
  })

  async function pickUser() {
    await userEvent.type(document.body.querySelector('input')!, 'john')
    const selectButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Select')
    selectButton?.click()
  }

  it('walks the three steps to a review summary', async () => {
    const { getByRole, getByText } = await wrap(<CreateEmployeePage />)

    await pickUser()
    await expect.element(getByText(/Step 2 — User & Basics/)).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: 'FakeDate' }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await expect.element(getByText(/Step 3 — Compensation/)).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await expect.element(getByText(/Step 4 — Bank Account/)).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await expect.element(getByText(/Review & Create/)).toBeInTheDocument()
    await expect.element(getByText('John Doe')).toBeInTheDocument()
  })

  it('submits a single nested POST with salary + bank payloads', async () => {
    const { getByRole, getByText } = await wrap(<CreateEmployeePage />)

    await pickUser()
    await userEvent.click(getByRole('button', { name: 'FakeDate' }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))

    // compensation: enable salary
    const switches = document.querySelectorAll('[role="switch"]')
    switches[0]?.click()
    await vi.waitFor(() => {
      expect(document.querySelector('input[type="number"]')).toBeDefined()
    })
    const salaryInputs = Array.from(document.querySelectorAll('input[type="number"]'))
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(salaryInputs[0], '50000')
    salaryInputs[0].dispatchEvent(new Event('input', { bubbles: true }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))

    // bank: enable + fill required, continue
    const bankSwitches = document.querySelectorAll('[role="switch"]')
    bankSwitches[0]?.click()
    await vi.waitFor(() => {
      expect(Array.from(document.querySelectorAll('input')).some((i) => i.placeholder === 'e.g. DBBL')).toBe(true)
    })
    const textInputs = Array.from(document.querySelectorAll('input'))
    const bankName = textInputs.find((i) => i.placeholder === 'e.g. DBBL')
    const accountNumber = textInputs.find((i) => i.placeholder === 'Account number')
    if (bankName && accountNumber) {
      setter.call(bankName, 'DBBL')
      bankName.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(accountNumber, '9876543210')
      accountNumber.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await userEvent.click(getByRole('button', { name: /Continue/ }))

    await expect.element(getByText(/Review & Create/)).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: /Create Employee/ }))
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalled()
    })

    const [url, payload] = mockPost.mock.calls[mockPost.mock.calls.length - 1]
    expect(url).toBe('/employees')
    expect(payload).toMatchObject({
      betterAuthUserId: 'u1',
      joiningDate: '2026-01-15',
      employmentType: 'full_time',
    })
    expect(payload.salaryStructure).toMatchObject({ basicSalary: 50000, effectiveFrom: expect.any(String) })
    expect(payload.bankAccount).toMatchObject({ bankName: 'DBBL', accountNumber: '9876543210', isPrimary: true })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/hr/employees/$id', params: { id: 'new-1' } })
  })

  it('submits without salary/bank when both are skipped', async () => {
    const { getByRole } = await wrap(<CreateEmployeePage />)

    await pickUser()
    await userEvent.click(getByRole('button', { name: 'FakeDate' }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))
    await userEvent.click(getByRole('button', { name: /Continue/ }))

    await userEvent.click(getByRole('button', { name: /Create Employee/ }))
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalled()
    })
    const [url, payload] = mockPost.mock.calls[mockPost.mock.calls.length - 1]
    expect(url).toBe('/employees')
    expect(payload.salaryStructure).toBeUndefined()
    expect(payload.bankAccount).toBeUndefined()
  })
})
