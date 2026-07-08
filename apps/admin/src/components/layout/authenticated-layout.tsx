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
      navigate({ to: '/sign-in', replace: true })
    }
  }, [accessToken, navigate])

  useEffect(() => {
    if (!accessToken) return
    const { user, setUser, reset } = useAuthStore.getState().auth
    if (user) return
    apiClient.get('/auth/me').then(r => {
      const u = r.data?.user || r.data
      if (u) {
        setUser({ id: u.id, email: u.email, role: u.role })
        if (u.role === 'packing_assistant') {
          const isOnPacking = window.location.pathname.startsWith('/op/packing')
          if (!isOnPacking) navigate({ to: '/op/packing', replace: true })
        }
      }
    }).catch(() => {
      reset()
      navigate({ to: '/sign-in', replace: true })
    })
  }, [accessToken, navigate])

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

    apiClient.get('/license/status').then(r => {
      const isActive = r.data?.active
      if (!isActive) {
        navigate({ to: '/license/activate', replace: true })
        return
      }
      const newFeatures: string[] = r.data?.license?.features || []
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
    }).catch(() => {
      useLicenseStore.getState().setFeatures([])
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
          setTimeout(() => navigate({ to: '/license/activate', replace: true }), 3000)
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
        } catch {}
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

  if (isPackingWorkspace) {
    return (
      <SearchProvider>
        <PanelProvider>
          <LayoutProvider>
            <div className="no-print"><SkipToMain /></div>
            <main className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
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
