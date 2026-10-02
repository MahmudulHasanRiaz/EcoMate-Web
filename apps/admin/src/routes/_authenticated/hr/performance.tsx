import { createFileRoute, redirect } from '@tanstack/react-router'
import { HrPerformancePage } from '@/features/hr-performance'
import { useAuthStore } from '@/stores/auth-store'

/**
 * The sidebar hides this link without `view_hr`, but hiding a link is not
 * access control: a user could still type the URL and the page would render,
 * relying entirely on the API returning 403. Guard the route too, matching the
 * backend's `@PermissionsAny('view_hr')` on HrController.
 */
export const Route = createFileRoute('/_authenticated/hr/performance')({
  beforeLoad: () => {
    const permissions = useAuthStore.getState().auth.user?.permissions ?? []
    if (!permissions.includes('view_hr')) {
      throw redirect({ to: '/' })
    }
  },
  component: HrPerformancePage,
})