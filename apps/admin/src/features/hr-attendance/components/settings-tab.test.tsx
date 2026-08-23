import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { SettingsTab } from './settings-tab'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const permissions = vi.hoisted(() => ({ value: ['manage_hr_settings'] }))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({
      auth: { user: { id: 'u1', email: 'a@b.c', role: 'admin', permissions: permissions.value } },
    }),
}))

const mockGet = vi.hoisted(() => vi.fn())
const mockPatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), patch: mockPatch, put: vi.fn(), delete: vi.fn() },
}))

function mockGetRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/hr/attendance/settings') {
      return Promise.resolve({ data: { id: 'global', mode: 'APP' } })
    }
    return Promise.resolve({ data: {} })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('SettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissions.value = ['manage_hr_settings']
    mockGetRoutes()
  })

  it('renders the mode radio cards with current mode selected', async () => {
    const { getByRole, getByText } = await wrap(<SettingsTab />)

    await expect.element(getByText('App', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Machine', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Both', { exact: true })).toBeInTheDocument()

    await vi.waitFor(() => expect(getByRole('radio').length).toBe(3))
    await expect.element(getByRole('radio').nth(0)).toBeChecked()
  })

  it('saves the new mode via PATCH when Save is clicked', async () => {
    const { getByRole } = await wrap(<SettingsTab />)

    await vi.waitFor(() => expect(getByRole('radio').length).toBe(3))
    await getByRole('radio').nth(2).click()

    await userEvent.click(getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/hr/attendance/settings', { mode: 'BOTH' })
    })
  })

  it('disables the controls and Save without manage_hr_settings permission', async () => {
    permissions.value = ['manage_attendance']
    const { getByRole, getByText } = await wrap(<SettingsTab />)

    await expect
      .element(getByText('Requires Manage HR Settings permission'))
      .toBeInTheDocument()
    await vi.waitFor(() => expect(getByRole('radio').length).toBe(3))
    await expect.element(getByRole('radio').nth(0)).toBeDisabled()
    await expect.element(getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})