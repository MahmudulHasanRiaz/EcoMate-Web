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
  payroll: {
    lastPeriodKey: string | null
    lastPeriodNet: number
    pendingApprovals: number
    paidThisMonth: number
    payable: number
  }
  recentPayments: {
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
}

export const hrApi = {
  overview: () =>
    apiClient.get<HrOverview>('/hr/overview').then((res) => res.data),
}