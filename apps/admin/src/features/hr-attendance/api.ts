import { apiClient } from '@/lib/api-client'

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE' | 'WEEKLY_OFF'

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'LATE',
  'HALF_DAY',
  'ON_LEAVE',
  'WEEKLY_OFF',
]

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half Day',
  ON_LEAVE: 'On Leave',
  WEEKLY_OFF: 'Weekly Off',
}

export const ATTENDANCE_STATUS_BADGE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  ABSENT: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  LATE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  HALF_DAY: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ON_LEAVE: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  WEEKLY_OFF: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
}

export interface AttendanceEmployee {
  employeeId: string
  status: string
  department: { name: string } | null
  designation: { name: string } | null
  betterAuthUser: { name: string } | null
}

export interface AttendanceRecord {
  id: string
  employeeId: string
  date: string
  status: AttendanceStatus
  checkInTime: string | null
  checkOutTime: string | null
  note: string | null
  recordedById: string | null
  createdAt: string
}

export interface AttendanceRow extends AttendanceRecord {
  employee: AttendanceEmployee
}

export interface AttendanceListResponse {
  data: AttendanceRow[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface DailyOverview {
  date: string
  total: number
  counts: Record<AttendanceStatus, number>
}

export interface CreateAttendanceDto {
  employeeId: string
  date: string
  status: AttendanceStatus
  checkInTime?: string
  checkOutTime?: string
  note?: string
}

export interface UpdateAttendanceDto {
  status?: AttendanceStatus
  checkInTime?: string | null
  checkOutTime?: string | null
  note?: string | null
}

export interface AttendanceListParams {
  date?: string
  employeeId?: string
  status?: AttendanceStatus
  departmentId?: string
  page?: number
  perPage?: number
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function toTimeInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const hrAttendanceApi = {
  listAttendance: (params: AttendanceListParams) =>
    apiClient.get<AttendanceListResponse>('/hr/attendance', { params }),
  createAttendance: (dto: CreateAttendanceDto) =>
    apiClient.post<AttendanceRow>('/hr/attendance', dto),
  updateAttendance: (id: string, dto: UpdateAttendanceDto) =>
    apiClient.patch<AttendanceRow>(`/hr/attendance/${id}`, dto),
  getDailyOverview: (date: string) =>
    apiClient.get<DailyOverview>('/hr/attendance/daily-overview', { params: { date } }),
  getAttendanceHistory: (employeeId: string, from?: string, to?: string) =>
    apiClient.get<AttendanceRecord[]>('/hr/attendance/history', { params: { employeeId, from, to } }),
}