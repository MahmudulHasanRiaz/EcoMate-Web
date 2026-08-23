import { apiClient } from '@/lib/api-client'

export interface ScheduleResponse {
  days: number[]
}

export interface HistoryEntry {
  id: string
  field: string
  oldValue: string | null
  newValue: string | null
  effectiveFrom: string
  changedBy: { firstName: string; lastName: string } | null
}

export interface HistoryResponse {
  data: HistoryEntry[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const hrScheduleApi = {
  getSchedule: (employeeId: string) =>
    apiClient.get<ScheduleResponse>(`/hr/employees/${employeeId}/schedule`),
  setSchedule: (employeeId: string, body: { days: number[]; note?: string }) =>
    apiClient.post<ScheduleResponse>(`/hr/employees/${employeeId}/schedule`, body),
  getHistory: (employeeId: string, page?: number, perPage?: number) =>
    apiClient.get<HistoryResponse>(`/hr/employees/${employeeId}/history`, {
      params: { page, perPage },
    }),
}