import { apiClient } from '@/lib/api-client'

export interface ShiftPreset {
  id: string
  name: string
  code: string
  startTime: string
  endTime: string
  graceMinutes: number
  breakMinutes: number
  standardMinutes: number
  overnight: boolean
  isActive: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  /**
   * Present on list — the currently-active rotations referencing this preset.
   * The service `include`s live assignments; there is no `_count` in the
   * response, so do not read one here.
   */
  assignments?: Array<{ id: string; employeeId: string }>
}

export interface ShiftRotationEntry {
  dayOfWeek: number
  shift: { id: string; name: string; code: string }
}

export interface CreateShiftPresetPayload {
  name: string
  code: string
  startTime: string
  endTime: string
  graceMinutes: number
  breakMinutes: number
  notes?: string
}

export type UpdateShiftPresetPayload = Partial<CreateShiftPresetPayload> & {
  isActive?: boolean
}

export const hrShiftsApi = {
  list: (includeInactive = false) =>
    apiClient.get<ShiftPreset[]>('/hr/shifts', {
      params: { includeInactive: includeInactive ? 'true' : undefined },
    }),
  create: (dto: CreateShiftPresetPayload) =>
    apiClient.post<ShiftPreset>('/hr/shifts', dto),
  update: (id: string, dto: UpdateShiftPresetPayload) =>
    apiClient.put<ShiftPreset>(`/hr/shifts/presets/${id}`, dto),
  deactivate: (id: string) =>
    apiClient.delete<ShiftPreset>(`/hr/shifts/presets/${id}`),

  rotation: (employeeId: string) =>
    apiClient.get<{ employeeId: string; rotation: ShiftRotationEntry[] }>(
      `/hr/shifts/employees/${employeeId}/rotation`,
    ),
  setRotationDay: (employeeId: string, dayOfWeek: number, shiftPresetId: string) =>
    apiClient.post(`/hr/shifts/employees/${employeeId}/rotation`, {
      dayOfWeek,
      shiftPresetId,
    }),
  clearRotationDay: (employeeId: string, dayOfWeek: number) =>
    apiClient.delete(`/hr/shifts/employees/${employeeId}/rotation`, {
      data: { dayOfWeek },
    }),

  findOrCreateCustom: (dto: CustomShiftPayload) =>
    apiClient.post<ShiftPreset>('/hr/shifts/custom-preset', dto),
  bulkSetRotation: (employeeId: string, rotations: BulkRotationItem[]) =>
    apiClient.post<{ employeeId: string; changedCount: number; total: number }>(
      `/hr/shifts/employees/${employeeId}/bulk-rotation`,
      { rotations }
    ),
  quickAssignPreset: (employeeId: string, shiftPresetId: string, days?: number[]) =>
    apiClient.post<{ employeeId: string; changedCount: number; total: number }>(
      `/hr/shifts/employees/${employeeId}/quick-assign`,
      { shiftPresetId, days }
    ),
}

export interface CustomShiftPayload {
  startTime: string
  endTime: string
  graceMinutes?: number
  breakMinutes?: number
  name?: string
}

export interface BulkRotationItem {
  dayOfWeek: number
  shiftPresetId?: string | null
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export function formatMinutes(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return '—'
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest}m`
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}