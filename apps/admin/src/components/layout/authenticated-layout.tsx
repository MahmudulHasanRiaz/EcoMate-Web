import { useEffect } from 'react'
import { Outlet, useNavigate } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { apiClient } from '@/lib/api-client'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { PanelProvider } from '@/context/panel-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SkipToMain } from '@/components/skip-to-main'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.auth.accessToken)

  useEffect(() => {
    if (!accessToken) {
      navigate({ to: '/sign-in', replace: true })
    }
  }, [accessToken, navigate])

  useEffect(() => {
    if (!accessToken) return
    const { user, setUser, reset } = useAuthStore.getState().auth
    if (user) return
    apiClient.get('/auth/me').then(r => {
      const u = r.data?.user || r.data
      if (u) setUser({ id: u.id, email: u.email, role: u.role })
    }).catch(() => {
      reset()
      navigate({ to: '/sign-in', replace: true })
    })
  }, [accessToken, navigate])

  useEffect(() => {
    if (!accessToken) return
    if (window.location.pathname.includes('/license/activate')) return

    apiClient.get('/license/status').then(r => {
      if (!r.data?.active) {
        navigate({ to: '/license/activate', replace: true })
      }
    }).catch(() => {
      // Allow access on status check failure (grace)
    })
  }, [accessToken, navigate])

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

  return (
    <SearchProvider>
      <PanelProvider>
      <LayoutProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <div className="no-print"><SkipToMain /></div>
          <AppSidebar />
          <SidebarInset
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
