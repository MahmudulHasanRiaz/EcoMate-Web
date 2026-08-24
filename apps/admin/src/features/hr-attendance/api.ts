import { apiClient } from '@/lib/api-client'

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE' | 'WEEKLY_OFF'
export type AttendanceMethod = 'APP' | 'MACHINE' | 'NONE'
export type AttendanceMode = 'APP' | 'MACHINE' | 'BOTH'
export type DayStateValue = 'none' | 'before_work' | 'working' | 'on_break' | 'checked_out'
export type AdjustmentField =
  | 'status'
  | 'workedMinutes'
  | 'breakMinutes'
  | 'checkInAt'
  | 'checkOutAt'
  | 'startedAt'
  | 'endedAt'
export type DeviceSyncStatus = 'IDLE' | 'CONNECTED' | 'DISCONNECTED' | 'SYNCING' | 'FAILED'

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

export const ATTENDANCE_METHOD_LABELS: Record<AttendanceMethod, string> = {
  APP: 'App attendance',
  MACHINE: 'Machine attendance',
  NONE: 'None (disabled)',
}

export interface AttendanceSession {
  id: string
  dayId: string
  source: string
  checkInAt: string
  checkOutAt: string | null
  breaks?: Array<{ id: string; startedAt: string; endedAt: string | null }>
}

export interface DayState {
  state: DayStateValue
  checkInAt?: string
  checkOutAt?: string
  workedMinutes: number
  breakMinutes: number
  /** True when the employee has an open session that never checked out. */
  missingCheckout?: boolean
}

export interface AttendanceEmployee {
  employeeId: string
  status: string
  department: { name: string } | null
  designation: { name: string } | null
  betterAuthUser: { name: string } | null
}

export interface AttendanceDayRow {
  id: string
  employeeId: string
  date: string
  status: AttendanceStatus
  attendanceMethod: AttendanceMethod | null
  workedMinutes: number | null
  breakMinutes: number | null
  note: string | null
  createdAt: string
  updatedAt: string
  sessions?: AttendanceSession[]
  employee: AttendanceEmployee
  missingCheckout?: boolean
}

export interface AttendanceListResponse {
  data: AttendanceDayRow[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface AttendanceListParams {
  date?: string
  employeeId?: string
  status?: AttendanceStatus
  departmentId?: string
  page?: number
  perPage?: number
}

export interface DailyOverview {
  date: string
  total: number
  counts: Record<AttendanceStatus, number>
}

export interface AttendanceAdjustment {
  id: string
  employeeId: string
  dayId: string | null
  field: string
  originalValue: string | null
  correctedValue: string
  reason: string
  adjustedAt: string
  employee?: { employeeId: string; betterAuthUser: { name: string } | null }
}

export interface AdjustmentListResponse {
  data: AttendanceAdjustment[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface CreateAdjustmentDto {
  employeeId: string
  dayId?: string
  field: AdjustmentField
  originalValue?: string
  correctedValue: string
  reason: string
}

export interface CreateAttendanceDayDto {
  employeeId: string
  date: string
  status: 'ABSENT' | 'ON_LEAVE' | 'WEEKLY_OFF'
  reason: string
  note?: string
}

export interface CloseSessionDto {
  dayId: string
  reason: string
}

export interface AttendanceSettings {
  id: string
  mode: AttendanceMode
  updatedById?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AttendanceDevice {
  id: string
  name: string
  deviceType: string
  vendor: string | null
  identifier: string | null
  location: string | null
  connectionMethod: string
  host: string | null
  port: number | null
  enabled: boolean
  syncStatus: DeviceSyncStatus
  lastSyncAt: string | null
  lastSyncError: string | null
  mappingCount?: number
  unmappedEventCount?: number
  createdAt: string
  updatedAt: string
}

export interface DeviceMapping {
  id: string
  deviceId: string
  employeeId: string
  deviceEmployeeId: string
  createdAt: string
  employee?: { employeeId: string; betterAuthUser: { name: string } | null }
}

export interface CreateDeviceDto {
  name: string
  deviceType: string
  vendor?: string
  identifier?: string
  location?: string
  connectionMethod?: string
  host?: string
  port?: number
  enabled?: boolean
  credentialsEncrypted?: string
}

export type UpdateDeviceDto = Partial<Omit<CreateDeviceDto, 'credentialsEncrypted'>>

export interface DeviceTestResult {
  syncStatus: 'CONNECTED' | 'DISCONNECTED'
  error?: string
  lastSyncAt?: string | null
}

export interface DeviceSyncResult {
  syncStatus: 'CONNECTED' | 'FAILED'
  error?: string
  lastSyncAt?: string | null
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Business-date helpers: the attendance day boundary runs on Asia/Dhaka. */
export function dhakaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const pick = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

/** A local-midnight Date whose local components equal the Dhaka business date. */
export function dhakaTodayDate(now: Date = new Date()): Date {
  const [y, m, d] = dhakaToday(now).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dhaka',
  })
}

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Dhaka',
  })
}

export function formatDuration(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return '—'
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest}m`
  return `${h}h ${rest}m`
}

export function getErrorMessage(e: unknown, fallback: string): string {
  const message = (e as any)?.response?.data?.message
  if (Array.isArray(message)) return message.join(', ')
  if (typeof message === 'string' && message.trim()) return message
  return fallback
}

/** First/last session times of a day row (list/history rows nest sessions). */
export function sessionTimes(row: AttendanceDayRow): {
  checkInAt: string | null
  checkOutAt: string | null
} {
  const sessions = row.sessions ?? []
  const first = sessions[0]
  const last = sessions[sessions.length - 1]
  return {
    checkInAt: first?.checkInAt ?? null,
    checkOutAt: last?.checkOutAt ?? null,
  }
}

export const hrAttendanceApi = {
  // State machine (admin-driven)
  checkIn: (employeeId: string, note?: string) =>
    apiClient.post('/hr/attendance/check-in', { employeeId, ...(note ? { note } : {}) }),
  breakStart: (employeeId: string) =>
    apiClient.post('/hr/attendance/break/start', { employeeId }),
  breakEnd: (employeeId: string) =>
    apiClient.post('/hr/attendance/break/end', { employeeId }),
  checkOut: (employeeId: string, note?: string) =>
    apiClient.post('/hr/attendance/check-out', { employeeId, ...(note ? { note } : {}) }),
  getToday: (employeeId: string, date?: string) =>
    apiClient.get<DayState>('/hr/attendance/today', {
      params: { employeeId, ...(date ? { date } : {}) },
    }),

  // Calendar list / overview / history
  listAttendance: (params: AttendanceListParams) =>
    apiClient.get<AttendanceListResponse>('/hr/attendance', { params }),
  getDailyOverview: (date: string) =>
    apiClient.get<DailyOverview>('/hr/attendance/daily-overview', { params: { date } }),
  getHistory: (employeeId: string, from?: string, to?: string) =>
    apiClient.get<AttendanceDayRow[]>('/hr/attendance/history', {
      params: { employeeId, from, to },
    }),

  // Adjustments
  listAdjustments: (params: { employeeId?: string; page?: number; perPage?: number }) =>
    apiClient.get<AdjustmentListResponse>('/hr/attendance/adjustments', { params }),
  createAdjustment: (dto: CreateAdjustmentDto) =>
    apiClient.post<AttendanceAdjustment>('/hr/attendance/adjustments', dto),

  // Manual day (G-03 UI)
  createDay: (dto: CreateAttendanceDayDto) =>
    apiClient.post<AttendanceDayRow>('/hr/attendance/days', dto),

  // Missing-checkout close (G-12)
  closeSession: (dto: CloseSessionDto) =>
    apiClient.post<{ dayId: string; sessionCount: number; checkOutAt: string }>(
      '/hr/attendance/close-session',
      dto,
    ),

  // Settings
  getSettings: () => apiClient.get<AttendanceSettings>('/hr/attendance/settings'),
  updateSettings: (mode: AttendanceMode) =>
    apiClient.patch<AttendanceSettings>('/hr/attendance/settings', { mode }),

  // Devices
  listDevices: () => apiClient.get<AttendanceDevice[]>('/hr/attendance/devices'),
  createDevice: (dto: CreateDeviceDto) =>
    apiClient.post<AttendanceDevice>('/hr/attendance/devices', dto),
  updateDevice: (id: string, dto: UpdateDeviceDto) =>
    apiClient.patch<AttendanceDevice>(`/hr/attendance/devices/${id}`, dto),
  deleteDevice: (id: string) =>
    apiClient.delete(`/hr/attendance/devices/${id}`),
  testDevice: (id: string) =>
    apiClient.post<DeviceTestResult>(`/hr/attendance/devices/${id}/test`),
  syncDevice: (id: string) =>
    apiClient.post<DeviceSyncResult>(`/hr/attendance/devices/${id}/sync`),
  listMappings: (deviceId: string) =>
    apiClient.get<DeviceMapping[]>(`/hr/attendance/devices/${deviceId}/mappings`),
  createMapping: (deviceId: string, dto: { employeeId: string; deviceEmployeeId: string }) =>
    apiClient.post<DeviceMapping>(`/hr/attendance/devices/${deviceId}/mappings`, dto),
  deleteMapping: (deviceId: string, mappingId: string) =>
    apiClient.delete(`/hr/attendance/devices/${deviceId}/mappings/${mappingId}`),
}