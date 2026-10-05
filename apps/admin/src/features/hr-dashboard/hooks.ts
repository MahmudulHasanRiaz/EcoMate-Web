import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, usePermission } from '@/lib/permissions'
import { hrApi } from './api'

/** The dashboard renders salary figures only for holders of manage_payroll. */
export function hasPayrollPermission(): boolean {
  return hasPermission(useAuthStore.getState().auth.user?.permissions, 'manage_payroll')
}

function useHrDashboardQuery(enabled: boolean) {
  return useQuery({
    // Permission-scoped key so switching users cannot serve one user's cached
    // (including payroll) payload to another.
    queryKey: ['hr-overview', { payroll: enabled }],
    queryFn: enabled ? hrApi.overview : hrApi.workforceOverview,
    refetchInterval: 60_000,
  })
}

/** Full dashboard including payroll figures. Requires manage_payroll. */
export function useHrOverviewQuery() {
  return useHrDashboardQuery(true)
}

/**
 * Dashboard without payroll figures, for managers who hold view_hr but not
 * manage_payroll. Hits GET /hr/overview/workforce, which omits the salary keys
 * server-side rather than relying on the UI to hide them.
 */
export function useHrWorkforceOverviewQuery() {
  // Subscribed (not a getState() read) so a user whose permissions change while
  // the dashboard is open lands on the workforce endpoint immediately.
  const canViewPayroll = usePermission('manage_payroll')
  return useHrDashboardQuery(!canViewPayroll)
}