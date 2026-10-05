import { useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { apiClient } from '@/lib/api-client'
import { useLicenseStore } from '@/stores/license-store'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { PanelProvider } from '@/context/panel-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AttendanceClock } from '@/features/hr-attendance/components/attendance-clock'
import { SkipToMain } from '@/components/skip-to-main'
import { toast } from 'sonner'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const navigate = useNavigate()
  const location = useLocation()
  const accessToken = useAuthStore((s) => s.auth.accessToken)
  const user = useAuthStore((s) => s.auth.user)

  useEffect(() => {
    if (!accessToken) {
      // A customer session bounce sets this marker so the plain sign-in
      // redirect (which fires when the token is cleared) carries the
      // explanatory message instead of silently dropping it.
      const bounce = sessionStorage.getItem('admin_customer_bounce')
      sessionStorage.removeItem('admin_customer_bounce')
      navigate({
        to: '/sign-in',
        ...(bounce ? { search: { customer: '1' } as const } : {}),
        replace: true,
      })
    }
  }, [accessToken, navigate])

  // A customer account must never use the admin app. Any customer session —
  // however it got here — is cleared and bounced to sign-in with an
  // explanation.
  useEffect(() => {
    if (user?.role !== 'customer') return
    const { reset } = useAuthStore.getState().auth
    sessionStorage.setItem('admin_customer_bounce', '1')
    reset()
    navigate({ to: '/sign-in', search: { customer: '1' }, replace: true })
  }, [user?.role, navigate])

  useEffect(() => {
    if (!accessToken) return
    const { user, setUser, reset } = useAuthStore.getState().auth
    // The login response carries no `permissions` key, so a cached user can exist
    // while every permission-gated surface reads `undefined`. Only skip the
    // /auth/me round-trip once permissions are actually present.
    if (user?.permissions?.length) return

    const applyUser = (u: {
      id: string
      email: string
      role: string
      permissions?: string[]
      firstName?: string
      lastName?: string
      username?: string
    }) => {
      setUser({
        id: u.id,
        email: u.email,
        role: u.role,
        permissions: u.permissions || [],
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
      })
      if (u.role === 'packing_assistant') {
        const isOnPacking = window.location.pathname.startsWith('/op/packing')
        if (!isOnPacking) navigate({ to: '/op/packing', replace: true })
      }
    }

    // Prefetched by the inline script during bundle download — apply instantly.
    try {
      const raw = sessionStorage.getItem('admin_prefetch')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.authMe) {
          const u = parsed.authMe.user || parsed.authMe
          if (u && u.id) {
            applyUser(u)
            return
          }
        }
      }
    } catch { /* fall through to API call */ }

    apiClient.get('/auth/me').then(r => {
      const u = r.data?.user || r.data
      if (u) applyUser(u)
    }).catch(() => {
      // Check if access token still exists — if yes, the interceptor is likely
      // retrying refresh. Don't reset immediately; let the interceptor handle it.
      const stillHasToken = !!(useAuthStore.getState().auth.accessToken)
      if (!stillHasToken) {
        reset()
        navigate({ to: '/sign-in', replace: true })
      }
    })
  }, [accessToken, navigate])

  // Proactive token keepalive: call /auth/me every 5 minutes.
  // When the access token expires during active use, this triggers the 401
  // interceptor → exponential backoff refresh → token rotates before the
  // user hits a real request (like Save on a form they've been editing).
  // The catch is silent: transient failures are handled by the interceptor
  // with exponential backoff, and we don't want to disrupt the user here.
  useEffect(() => {
    if (!accessToken) return

    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get('/auth/me')
        const u = res.data?.user || res.data
        if (u) {
          const { setUser } = useAuthStore.getState().auth
          setUser({
            id: u.id,
            email: u.email,
            role: u.role,
            permissions: u.permissions || [],
            firstName: u.firstName,
            lastName: u.lastName,
            username: u.username,
          })
        }
      } catch {
        // Silent — the interceptor handles 401 with exponential backoff.
        // A momentary failure here won't redirect or clear auth.
      }
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [accessToken])

  // Enforce redirection for packing_assistant role on path changes
  useEffect(() => {
    if (user?.role === 'packing_assistant') {
      const isOnPacking = location.pathname.startsWith('/op/packing')
      if (!isOnPacking) {
        navigate({ to: '/op/packing', replace: true })
      }
    }
  }, [user, location.pathname, navigate])

  useEffect(() => {
    if (!accessToken) return
    if (window.location.pathname.includes('/license/activate')) return

    const applyLicenseStatus = (data: {
      active?: boolean
      features?: string[]
      license?: { features?: string[] }
    }) => {
      const isActive = data?.active
      if (!isActive) {
        // License genuinely needed: send the user straight to the standalone
        // activation page (no sidebar shell, no half-hidden menus) and return
        // them to the page they were on once the license is active again.
        const currentPath = window.location.pathname + window.location.search
        navigate({
          to: '/license/activate',
          search: { redirect: currentPath },
          replace: true,
        })
        return
      }
      // /license/status returns the effective feature list at the TOP level
      // (this is where the dev-mode '*' wildcard lives). `license.features` is
      // the raw engine payload and is absent in dev mode.
      const newFeatures: string[] = data?.features || data?.license?.features || []
      const { added, removed } = useLicenseStore.getState().setFeatures(newFeatures)

      if (added.length > 0 && removed.length > 0) {
        toast.info(
          `Your plan has been updated. New: ${added.join(', ')}. Removed: ${removed.join(', ')}.`,
          { duration: 6000 }
        )
      } else if (added.length > 0) {
        toast.success(
          `New features unlocked: ${added.join(', ')}.`,
          { duration: 6000 }
        )
      } else if (removed.length > 0) {
        const hasInventory = removed.includes('admin_inventory')
        const inventoryNote = hasInventory
          ? ' Inventory is now read-only — existing products reverted to basic stock.'
          : ''
        toast.warning(
          `Features removed from your plan: ${removed.join(', ')}. Some sections may be hidden.${inventoryNote}`,
          { duration: 6000 }
        )
      }
    }

    // Prefetched by the inline script during bundle download — apply instantly.
    try {
      const raw = sessionStorage.getItem('admin_prefetch')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.licenseStatus) {
          applyLicenseStatus(parsed.licenseStatus)
          return
        }
      }
    } catch { /* fall through to API call */ }

    apiClient.get('/license/status').then(r => applyLicenseStatus(r.data)).catch(() => {
      // A transient network failure must NOT look like "no license": clearing
      // features here used to collapse the whole sidebar on a momentary blip.
      // Only an authoritative `active: false` response redirects/clears.
    })
  }, [accessToken, navigate])

  useEffect(() => {
    if (!accessToken) return

    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get('/license/status')
        if (res.data?.state === 'expired' || res.data?.state === 'invalid') {
          useLicenseStore.getState().setFeatures([])
          toast.error('Your license has expired. Redirecting to license page...')
          const currentPath = window.location.pathname + window.location.search
          setTimeout(
            () =>
              navigate({
                to: '/license/activate',
                search: { redirect: currentPath },
                replace: true,
              }),
            3000
          )
        }
      } catch {
        // Silently fail — network issues shouldn't interrupt work
      }
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [accessToken, navigate])

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'eco_mate_features' && e.newValue) {
        try {
          const features = JSON.parse(e.newValue)
          useLicenseStore.getState().setFeatures(features)
        } catch { /* ignore malformed feature payload */ }
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  if (!accessToken) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid #e2e8f0',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            animation: 'auth-spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes auth-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const isPackingWorkspace = location.pathname.startsWith('/op/packing')

  // Panel identity for the 2px accent line under the top bar (presentational only).
  const panel = location.pathname.startsWith('/mon')
    ? 'monitoring'
    : location.pathname.startsWith('/hr')
      ? 'hr'
      : location.pathname.startsWith('/op/packing')
        ? 'packing'
        : 'operational'

  if (isPackingWorkspace) {
    return (
      <SearchProvider>
        <PanelProvider>
          <LayoutProvider>
            <div className="no-print"><SkipToMain /></div>
            <main
              data-panel="packing"
              className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950"
            >
              <div className="panel-accent-line" aria-hidden />
              {children ?? <Outlet />}
            </main>
          </LayoutProvider>
        </PanelProvider>
      </SearchProvider>
    )
  }

  return (
    <SearchProvider>
      <PanelProvider>
      <LayoutProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <div className="no-print"><SkipToMain /></div>
          <AppSidebar />
          {/* Portals the attendance clock into whatever <Header> the current
              page renders. Keeping it mounted here (not per-page) is what makes
              the clock available across the whole app. */}
          <AttendanceClock />
          <SidebarInset
            data-panel={panel}
            className={cn(
              '@container/content',
              'has-data-[layout=fixed]:h-svh',
              'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
            )}
          >
            {children ?? <Outlet />}
          </SidebarInset>
        </SidebarProvider>
      </LayoutProvider>
      </PanelProvider>
    </SearchProvider>
  )
}
