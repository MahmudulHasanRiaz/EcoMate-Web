import { apiClient } from '@/lib/api-client'

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface LeaveType {
  id: string
  name: string
  code: string
  daysPerYear: number
  isPaid: boolean
  isActive: boolean
}

export interface LeaveRequest {
  id: string
  employeeId: string
  employee: { employeeId: string; betterAuthUser: { name: string } }
  type: { name: string; code: string }
  startDate: string
  endDate: string
  days: number
  reason: string
  status: LeaveStatus
  decisionNote?: string | null
  approvedAt?: string | null
}

export interface LeaveBalance {
  typeId: string
  typeName: string
  isPaid: boolean
  entitlement: number
  used: number
  remaining: number
}

export interface LeaveListResponse {
  data: LeaveRequest[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface CalendarLeave {
  id: string
  employeeId: string
  typeName: string
  startDate: string
  endDate: string
}

export interface CreateLeaveTypeDto {
  name: string
  code: string
  daysPerYear: number
  isPaid?: boolean
  isActive?: boolean
}

export type UpdateLeaveTypeDto = Partial<CreateLeaveTypeDto>

export interface CreateLeaveRequestDto {
  employeeId: string
  typeId: string
  startDate: string
  endDate: string
  days?: number
  reason: string
}

export const hrLeaveApi = {
  createType: (dto: CreateLeaveTypeDto) =>
    apiClient.post<LeaveType>('/hr/leave-types', dto),
  listTypes: (params?: { isActive?: boolean }) =>
    apiClient.get<LeaveType[]>('/hr/leave-types', { params }),
  updateType: (id: string, dto: UpdateLeaveTypeDto) =>
    apiClient.patch<LeaveType>(`/hr/leave-types/${id}`, dto),
  deleteType: (id: string) =>
    apiClient.delete(`/hr/leave-types/${id}`),

  createRequest: (dto: CreateLeaveRequestDto) =>
    apiClient.post<LeaveRequest>('/hr/leave-requests', dto),
  listRequests: (params: { employeeId?: string; status?: LeaveStatus; page?: number; perPage?: number }) =>
    apiClient.get<LeaveListResponse>('/hr/leave-requests', { params }),
  approveRequest: (id: string, decisionNote?: string) =>
    apiClient.patch<LeaveRequest>(`/hr/leave-requests/${id}/approve`, { decisionNote }),
  rejectRequest: (id: string, decisionNote: string) =>
    apiClient.patch<LeaveRequest>(`/hr/leave-requests/${id}/reject`, { decisionNote }),
  cancelRequest: (id: string) =>
    apiClient.patch<LeaveRequest>(`/hr/leave-requests/${id}/cancel`),

  getBalances: (employeeId: string) =>
    apiClient.get<LeaveBalance[]>('/hr/leave-balances', { params: { employeeId } }),
  getCalendar: (params: { employeeId?: string; year: number; month: number }) =>
    apiClient.get<CalendarLeave[]>('/hr/leave-calendar', { params }),
}
