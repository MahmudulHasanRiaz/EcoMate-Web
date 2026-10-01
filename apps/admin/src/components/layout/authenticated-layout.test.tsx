import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const authState = vi.hoisted(() => ({
  accessToken: 'tok' as string,
  user: null as null | { id: string; email: string; role: string; permissions?: string[] },
}))

const setUser = vi.hoisted(() => vi.fn())
const reset = vi.hoisted(() => vi.fn())
const getMe = vi.hoisted(() => vi.fn())
const getLicenseStatus = vi.hoisted(() => vi.fn())

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: any) => unknown) =>
      selector({
        auth: { accessToken: authState.accessToken, user: authState.user, setUser, reset },
      }),
    { getState: () => ({ auth: { accessToken: authState.accessToken, user: authState.user, setUser, reset } }) }
  ),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (url: string) => (url === '/auth/me' ? getMe() : getLicenseStatus()) },
}))

vi.mock('@/stores/license-store', () => ({
  useLicenseStore: Object.assign(
    (selector: (s: any) => unknown) => selector({ features: ['*'], setFeatures: vi.fn(), getState: () => ({ setFeatures: vi.fn() }) }),
    { getState: () => ({ setFeatures: vi.fn() }) }
  ),
}))

// Layout chrome is irrelevant to these assertions and pulls in the whole shell.
vi.mock('@/components/layout/app-sidebar', () => ({ AppSidebar: () => null }))
// The real widget portals into the <Header>; stub it so the layout test stays
// focused on permission + license bootstrapping.
vi.mock('@/features/hr-attendance/components/attendance-clock', () => ({ AttendanceClock: () => null }))
vi.mock('@/components/skip-to-main', () => ({ SkipToMain: () => null }))
vi.mock('@/components/layout/header', () => ({ Header: () => null }))
vi.mock('@/components/layout/main', () => ({ Main: ({ children }: any) => children }))
vi.mock('@/components/layout/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: any) => children,
  SidebarInset: ({ children }: any) => children,
  SidebarTrigger: () => null,
}))
vi.mock('@/context/layout-provider', () => ({ LayoutProvider: ({ children }: any) => children }))
vi.mock('@/context/search-provider', () => ({ SearchProvider: ({ children }: any) => children }))
vi.mock('@/context/panel-provider', () => ({ PanelProvider: ({ children }: any) => children }))

const navigate = vi.hoisted(() => vi.fn())
const location = vi.hoisted(() => ({ pathname: '/op/overview' }))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useNavigate: () => navigate,
  useLocation: () => location,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/cookies', () => ({ getCookie: () => 'true', setCookie: vi.fn(), removeCookie: vi.fn() }))

import { AuthenticatedLayout } from './authenticated-layout'

describe('AuthenticatedLayout permission bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.accessToken = 'tok'
    authState.user = null
    sessionStorage.clear()
    getLicenseStatus.mockResolvedValue({ data: { active: true, features: ['*'] } })
  })

  it('fetches /auth/me when no user is cached', async () => {
    getMe.mockResolvedValue({ data: { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['manage_hr_settings'] } })
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(getMe).toHaveBeenCalled())
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ['manage_hr_settings'] })
    )
  })

  it('re-fetches when the cached user has NO permissions (the login-response shape)', async () => {
    // POST /auth/login returns { id, email, role } — no permissions key. That
    // object was cached verbatim, so every permission-gated surface read
    // `undefined` and the superadmin saw no HR Settings.
    authState.user = { id: 'u1', email: 'a@b.c', role: 'superadmin' }
    getMe.mockResolvedValue({ data: { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['manage_hr_settings'] } })

    render(<AuthenticatedLayout />)

    await waitFor(() => expect(getMe).toHaveBeenCalled())
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ['manage_hr_settings'] })
    )
  })

  it('skips /auth/me once permissions are already present', async () => {
    authState.user = { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['view_hr'] }
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(getLicenseStatus).toHaveBeenCalled())
    expect(getMe).not.toHaveBeenCalled()
    expect(setUser).not.toHaveBeenCalled()
  })
})

describe("AuthenticatedLayout '*' wildcard handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.accessToken = 'tok'
    authState.user = null
    sessionStorage.clear()
    getMe.mockResolvedValue({ data: { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['*'] } })
  })

  it('reads features from the TOP level of /license/status', async () => {
    // Backend returns the effective list at the top level — that is where the
    // dev-mode '*' lives. Reading `license.features` alone yielded [] and hid
    // every sidebar section.
    getLicenseStatus.mockResolvedValue({ data: { active: true, features: ['*'], license: null } })
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(getLicenseStatus).toHaveBeenCalled())
    // No crash, and no redirect to /license/activate.
    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: '/license/activate' }),
      undefined
    )
  })
})