import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasPermission } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth-store'
import AccessPresetsPage from '@/features/access-presets'

/**
 * Access presets decide who may use the whole application, so this is the
 * narrowest surface in the app: the backend restricts it to
 * `@Roles('superadmin','admin')`. Hiding the sidebar link is not access control —
 * a user who types /hr/presets got the full editor with its error-free empty
 * state. `manage_presets` is the one grantable key on this surface (and the one
 * a delegated admin can hold), so it gates the route alongside the role check.
 */
export const Route = createFileRoute('/_authenticated/hr/presets')({
  beforeLoad: () => {
    const user = useAuthStore.getState().auth.user
    const isAdminRole = user?.role === 'superadmin' || user?.role === 'admin'
    if (!isAdminRole || !hasPermission(user?.permissions, 'manage_presets')) {
      throw redirect({ to: '/' })
    }
  },
  component: AccessPresetsPage,
})