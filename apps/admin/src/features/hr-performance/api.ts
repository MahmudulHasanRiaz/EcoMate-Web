import { apiClient } from '@/lib/api-client'

export interface StaffOrderMetrics {
  employeeId: string
  employeeCode: string
  name: string
  email: string
  department: string | null
  designation: string | null
  avatar: string | null
  ordersHandled: number
  confirmed: number
  confirmationRate: number
  delivered: number
  deliveryRate: number
  endToEndDeliveryRate: number
  returned: number
  returnRate: number
  cancelled: number
  cancellationRate: number
  totalRevenue: number
}

export interface StaffPerformanceSummary {
  totalOrdersHandled: number
  totalConfirmed: number
  overallConfirmationRate: number
  totalDelivered: number
  overallDeliveryRate: number
  overallEndToEndDeliveryRate: number
  totalReturned: number
  overallReturnRate: number
  totalCancelled: number
  overallCancellationRate: number
  totalRevenue: number
}

export interface StaffPerformanceResponse {
  data: StaffOrderMetrics[]
  summary: StaffPerformanceSummary
  meta: {
    page: number
    perPage: number
    total: number
    totalPages: number
    from: string
    to: string
    definitions: Record<string, string>
  }
}

export interface TaskProductivityRow {
  employeeId: string
  employeeCode: string
  name: string
  email: string
  avatar: string | null
  department: string | null
  designation: string | null
  assigned: number
  completed: number
  pending: number
  completionRate: number
  timeSpentMinutes: number
  timeSpentDisplay: string
  avgTaskDurationMinutes: number
  avgTaskDurationDisplay: string
}

export interface TaskProductivityResponse {
  data: TaskProductivityRow[]
  meta: {
    page: number
    perPage: number
    total: number
    totalPages: number
    from: string
    to: string
    dateSemantics: Record<string, string>
  }
}

export interface DrilldownOrder {
  id: string
  displayId: string
  status: string
  total: number
  createdAt: string
  customerName: string
  customerPhone: string
  events: {
    action: string
    fromStatus: string | null
    toStatus: string | null
    createdAt: string
    note: string | null
  }[]
}

export const hrPerformanceApi = {
  getOrderPerformance: (params: {
    from?: string
    to?: string
    employeeId?: string
    departmentId?: string
    page?: number
    perPage?: number
  }) =>
    apiClient
      .get<StaffPerformanceResponse>('/hr/performance/orders', { params })
      .then((res) => res.data),

  getOrderDrilldown: (
    employeeId: string,
    params: { from?: string; to?: string; stage?: string; page?: number; perPage?: number },
  ) =>
    apiClient
      .get<{ data: DrilldownOrder[]; meta: any }>(
        `/hr/performance/orders/${employeeId}/drilldown`,
        { params },
      )
      .then((res) => res.data),

  getTaskPerformance: (params: {
    from?: string
    to?: string
    departmentId?: string
    employeeId?: string
    page?: number
    perPage?: number
  }) =>
    apiClient
      .get<TaskProductivityResponse>('/hr/performance/tasks', { params })
      .then((res) => res.data),

  backfillOrderEvents: () =>
    apiClient
      .post<{ count: number; message: string }>('/hr/performance/orders/backfill')
      .then((res) => res.data),
}
