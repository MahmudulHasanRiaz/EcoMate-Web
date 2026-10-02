import { apiClient } from '@/lib/api-client'
import type { PayslipResponse } from '@/features/payroll/api'

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type EmployeeStatus = 'active' | 'probation' | 'suspended' | 'resigned' | 'terminated'
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern'
export type EmployeeGender = 'MALE' | 'FEMALE' | 'OTHER'
export type AttendanceMethod = 'APP' | 'MACHINE' | 'NONE'
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE' | 'WEEKLY_OFF'

export interface MyProfileResponse {
  id: string
  employeeId: string
  departmentId?: string | null
  designationId?: string | null
  reportingToId?: string | null
  employmentType: EmploymentType
  status: EmployeeStatus
  joiningDate: string
  exitDate?: string | null
  confirmationDate?: string | null
  salary?: number | string | null
  bankAccountNo?: string | null
  bankName?: string | null
  profilePictureUrl?: string | null
  notes?: string | null
  dateOfBirth?: string | null
  gender?: EmployeeGender | null
  nationality?: string | null
  nidNumber?: string | null
  presentAddress?: string | null
  permanentAddress?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  emergencyContactRelation?: string | null
  attendanceMethod: AttendanceMethod
  createdAt: string
  updatedAt: string
  department?: { id: string; name: string } | null
  designation?: { id: string; name: string } | null
  betterAuthUser?: { name?: string; email?: string; image?: string | null } | null
  userProfile?: { id: string; username?: string; phoneNumber?: string } | null
  reportingTo?: {
    employeeId: string
    betterAuthUser?: { name: string } | null
  } | null
  salaryStructures?: Array<{
    id: string
    basicSalary: number | string
    houseAllowance: number | string
    medicalAllowance: number | string
    transportAllowance: number | string
    otherAllowance: number | string
    taxDeduction: number | string
    insuranceDeduction: number | string
    otherDeduction: number | string
    totalEarnings: number | string
    totalDeductions: number | string
    netSalary: number | string
    effectiveFrom: string
  }>
  bankAccounts?: Array<{
    id: string
    accountTitle: string
    accountNumber: string
    bankName: string
    branchName?: string | null
    routingNumber?: string | null
    accountType: string
    isPrimary: boolean
    verificationStatus: string
  }>
  weeklyOffs?: Array<{
    id: string
    dayOfWeek: number
    effectiveFrom: string
    note?: string | null
  }>
  reports?: Array<{
    id: string
    employeeId: string
    status: string
    designation?: { name: string } | null
    betterAuthUser?: { name?: string; email?: string } | null
  }>
}

export interface MyPerformanceResponse {
  orders: {
    totalAssignedOrders: number
    deliveredOrders: number
    processingOrders: number
    cancelledOrders: number
    totalDeliveredAmount: number
    deliveryRate: number
    recentOrders: Array<{
      id: string
      displayId: string
      customerName: string
      customerPhone: string
      total: number
      status: string
      statusColor: string
      createdAt: string
    }>
  }
  leads: {
    assignedLeads: number
    convertedLeads: number
    conversionRate: number
  }
  tasks: {
    totalTasks: number
    completedTasks: number
    pendingTasks: number
    completionRate: number
    recentTasks: Array<{
      id: string
      displayId: string
      title: string
      status: string
      priority: string
      dueDate?: string | null
      createdAt: string
    }>
  }
  attendance: {
    presentDays: number
    lateDays: number
    halfDays: number
    absentDays: number
    totalWorkedMinutes: number
    workedHours: number
    onTimeRate: number
  }
  financial: {
    baseSalary: number
    totalCommission: number
    monthCommission: number
    totalBonuses: number
    latestPayslip: {
      periodKey?: string | null
      netPay: number
      status: string
      paidAt?: string | null
    } | null
  }
  leaves: {
    totalRemaining: number
    pendingCount: number
    balances: Array<{
      typeId: string
      typeName: string
      isPaid: boolean
      entitlement: number
      used: number
      remaining: number
    }>
  }
}

export interface MyLeaveType {
  id: string
  name: string
  code: string
  daysPerYear: number
  isPaid: boolean
  isActive: boolean
}

export interface MyLeaveBalance {
  typeId: string
  typeName: string
  isPaid: boolean
  entitlement: number
  used: number
  remaining: number
}

export interface MyLeaveRequest {
  id: string
  employeeId: string
  typeId: string
  type: { name: string; code: string }
  startDate: string
  endDate: string
  days: number
  reason: string
  status: LeaveStatus
  decisionNote?: string | null
  approvedAt?: string | null
  createdAt: string
}

export interface MyLeaveListResponse {
  data: MyLeaveRequest[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface CreateMyLeaveRequestDto {
  typeId: string
  startDate: string
  endDate: string
  days?: number
  reason: string
}

export interface MyDayState {
  state: 'not_checked_in' | 'working' | 'on_break' | 'checked_out'
  checkInAt?: string | null
  checkOutAt?: string | null
  workedMinutes?: number
  breakMinutes?: number
  appAllowed?: boolean
  appBlockedReason?: string
}

export interface MyAttendanceHistoryRow {
  id: string
  date: string
  status: AttendanceStatus
  workedMinutes?: number | null
  breakMinutes?: number | null
  note?: string | null
  sessions?: Array<{
    id: string
    checkInAt: string
    checkOutAt?: string | null
    breaks?: Array<{
      id: string
      startedAt: string
      endedAt?: string | null
    }>
  }>
}

export interface MyPayslipRow {
  id: string
  periodKey?: string | null
  periodStart: string
  periodEnd: string
  totalEarnings: number | string
  totalDeductions: number | string
  netPay: number | string
  status: string
  paidAt?: string | null
  generatedAt: string
}

export interface MyPayslipListResponse {
  data: MyPayslipRow[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface MyCommissionEarningRow {
  id: string
  amount: number | string
  status: string
  createdAt: string
  order?: {
    id: string
    displayId: string
    total: number | string
  } | null
}

export interface MyCommissionListResponse {
  data: MyCommissionEarningRow[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface MyEmployeeEarningRow {
  id: string
  type: string
  amount: number | string
  reason: string
  status: string
  applicableFrom?: string | null
  createdAt: string
}

export const myProfileApi = {
  getProfile: () => apiClient.get<MyProfileResponse>('/hr/my/profile'),
  getPerformance: () => apiClient.get<MyPerformanceResponse>('/hr/my/performance'),

  // Leaves
  getLeaveBalances: () => apiClient.get<MyLeaveBalance[]>('/hr/my/leave-balances'),
  getLeaveTypes: () => apiClient.get<MyLeaveType[]>('/hr/my/leave-types'),
  getLeaveRequests: (page = 1, perPage = 20) =>
    apiClient.get<MyLeaveListResponse>('/hr/my/leave-requests', { params: { page, perPage } }),
  createLeaveRequest: (dto: CreateMyLeaveRequestDto) =>
    apiClient.post<MyLeaveRequest>('/hr/my/leave-requests', dto),
  cancelLeaveRequest: (id: string) =>
    apiClient.patch<MyLeaveRequest>(`/hr/my/leave-requests/${id}/cancel`),

  // Attendance
  getTodayAttendance: () => apiClient.get<MyDayState>('/hr/my/attendance/today'),
  getAttendanceHistory: (from?: string, to?: string) =>
    apiClient.get<MyAttendanceHistoryRow[]>('/hr/my/attendance', { params: { from, to } }),
  checkIn: (note?: string) => apiClient.post<{ id: string }>('/hr/my/attendance/check-in', { note }),
  breakStart: () => apiClient.post<{ id: string }>('/hr/my/attendance/break/start', {}),
  breakEnd: () => apiClient.post<{ id: string }>('/hr/my/attendance/break/end', {}),
  checkOut: (note?: string) => apiClient.post<{ id: string }>('/hr/my/attendance/check-out', { note }),

  // Salary & Payroll
  getSalary: () => apiClient.get<any>('/hr/my/salary'),
  getPayslips: (page = 1, perPage = 20) =>
    apiClient.get<MyPayslipListResponse>('/hr/my/payslips', { params: { page, perPage } }),
  getPayslipPayments: (payslipId: string) =>
    apiClient.get<any[]>(`/hr/my/payslips/${payslipId}/payments`),
  /**
   * Full payslip statement for self-service.
   *
   * Must not be the payroll admin endpoint (GET /payroll/payslips/:id): that
   * one is restricted to superadmin/admin/manager, so the payslip drill-down
   * returned 403 for a plain employee. This route is scoped server-side to the
   * caller's own employee record.
   */
  getPayslip: (payslipId: string) =>
    apiClient
      .get<PayslipResponse>(`/hr/my/payslips/${payslipId}`)
      .then((r) => r.data),
  getCommissions: (page = 1, perPage = 20) =>
    apiClient.get<MyCommissionListResponse>('/hr/my/commissions', { params: { page, perPage } }),
  getEarnings: (page = 1, perPage = 20) =>
    apiClient.get<{ data: MyEmployeeEarningRow[]; meta: any }>('/hr/my/earnings', { params: { page, perPage } }),
  getDeductions: (page = 1, perPage = 20) =>
    apiClient.get<{ data: any[]; meta: any }>('/hr/my/deductions', { params: { page, perPage } }),
  getSchedule: () => apiClient.get<any>('/hr/my/schedule'),
}
