import { apiClient } from '@/lib/api-client'

export interface HrOverview {
  employees: {
    total: number
    active: number
    inactive: number
    on_leave: number
    suspended: number
    terminated: number
    resigned: number
  }
  /** Omitted entirely when the caller lacks manage_payroll. */
  payroll?: {
    lastPeriodKey: string | null
    lastPeriodNet: number
    pendingApprovals: number
    paidThisMonth: number
    payable: number
  }
  recentPayments?: {
    id: string
    employeeId: string
    employeeName: string
    netPay: number
    paidAt: string
    periodKey: string | null
  }[]
  queues: {
    pendingLeaveRequests: number
  }
  commissionThisMonth: number
  attendance?: {
    date: string
    total: number
    present: number
    absent: number
    onLeave: number
    weeklyOff: number
    late: number
    currentlyWorking: number
    onBreak: number
    missingCheckout: number
    workedMinutes: number
    breakMinutes: number
    overtimeMinutes: number
  }
  tasks?: {
    createdToday: number
    completedToday: number
    pendingTotal: number
    completionRateToday: number
  }
  orderOperations?: {
    periodLabel: string
    handled: number
    confirmed: number
    confirmationRate: number
    delivered: number
    /** Delivered / Confirmed */
    deliveryRateFromConfirmed: number
    /** Delivered / Handled */
    endToEndDeliveryRate: number
    returned: number
    /** Returned / Delivered */
    returnRate: number
    cancelled: number
    /** Cancelled / Handled */
    cancellationRate: number
  }
  exceptions?: {
    missingCheckout: number
    pendingLeaveRequests: number
    overdueTasksTotal: number
  }
}

export const hrApi = {
  /**
   * Full dashboard payload. Requires manage_payroll, because it carries salary
   * figures.
   */
  overview: () => apiClient.get<HrOverview>('/hr/overview').then((res) => res.data),

  /**
   * Same dashboard without payroll figures, for view_hr-only managers.
   * GET /hr/overview is guarded by manage_payroll so the salary fields are not
   * merely hidden — they are never sent.
   */
  workforceOverview: () =>
    apiClient.get<HrOverview>('/hr/overview/workforce').then((res) => res.data),
}