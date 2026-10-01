import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  hrAttendanceApi,
  hrMyAttendanceApi,
  getErrorMessage,
  type AttendanceListParams,
  type AttendanceMode,
  type CreateAdjustmentDto,
  type CreateAttendanceDayDto,
  type CreateDeviceDto,
  type UpdateDeviceDto,
} from './api'

const TODAY_KEY = 'hr-attendance-today'
const LIST_KEY = 'hr-attendance'
const OVERVIEW_KEY = 'hr-attendance-overview'
const HISTORY_KEY = 'hr-attendance-history'
const ADJUSTMENTS_KEY = 'hr-attendance-adjustments'
const SETTINGS_KEY = 'hr-attendance-settings'
const DEVICES_KEY = 'hr-attendance-devices'
const MAPPINGS_KEY = 'hr-attendance-device-mappings'

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [TODAY_KEY] })
  queryClient.invalidateQueries({ queryKey: [LIST_KEY] })
  queryClient.invalidateQueries({ queryKey: [OVERVIEW_KEY] })
  queryClient.invalidateQueries({ queryKey: [HISTORY_KEY] })
}

// ---------------------------------------------------------------------------
// Day state (Today tab + employee detail mini state)
// ---------------------------------------------------------------------------

export function useTodayStateQuery(employeeId: string, date?: string) {
  return useQuery({
    queryKey: [TODAY_KEY, employeeId, date ?? ''],
    queryFn: () => hrAttendanceApi.getToday(employeeId, date).then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useCheckInMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { employeeId: string; note?: string }) =>
      hrAttendanceApi.checkIn(payload.employeeId, payload.note).then((r) => r.data),
    onSuccess: () => {
      invalidateAll(queryClient)
      toast.success('Checked in')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not check in')),
  })
}

export function useBreakStartMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (employeeId: string) =>
      hrAttendanceApi.breakStart(employeeId).then((r) => r.data),
    onSuccess: () => {
      invalidateAll(queryClient)
      toast.success('Break started')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not start break')),
  })
}

export function useBreakEndMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (employeeId: string) =>
      hrAttendanceApi.breakEnd(employeeId).then((r) => r.data),
    onSuccess: () => {
      invalidateAll(queryClient)
      toast.success('Break ended')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not end break')),
  })
}

export function useCheckOutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { employeeId: string; note?: string }) =>
      hrAttendanceApi.checkOut(payload.employeeId, payload.note).then((r) => r.data),
    onSuccess: () => {
      invalidateAll(queryClient)
      toast.success('Checked out')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not check out')),
  })
}

// ---------------------------------------------------------------------------
// Calendar list / overview / history
// ---------------------------------------------------------------------------

export function useAttendanceQuery({
  date,
  employeeId,
  status,
  departmentId,
  page = 1,
  perPage = 20,
}: AttendanceListParams) {
  return useQuery({
    queryKey: [LIST_KEY, date, employeeId, status, departmentId, page, perPage],
    queryFn: () =>
      hrAttendanceApi
        .listAttendance({ date, employeeId, status, departmentId, page, perPage })
        .then((r) => r.data),
  })
}

export function useDailyOverviewQuery(date: string) {
  return useQuery({
    queryKey: [OVERVIEW_KEY, date],
    queryFn: () => hrAttendanceApi.getDailyOverview(date).then((r) => r.data),
    enabled: !!date,
  })
}

export function useAttendanceHistoryQuery(employeeId: string, from?: string, to?: string) {
  return useQuery({
    queryKey: [HISTORY_KEY, employeeId, from ?? '', to ?? ''],
    queryFn: () => hrAttendanceApi.getHistory(employeeId, from, to).then((r) => r.data),
    enabled: !!employeeId,
  })
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export function useAdjustmentsQuery(employeeId: string, page = 1) {
  return useQuery({
    queryKey: [ADJUSTMENTS_KEY, employeeId, page],
    queryFn: () =>
      hrAttendanceApi
        .listAdjustments({ employeeId: employeeId || undefined, page })
        .then((r) => r.data),
  })
}

export function useCreateAdjustmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateAdjustmentDto) =>
      hrAttendanceApi.createAdjustment(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADJUSTMENTS_KEY] })
      invalidateAll(queryClient)
      toast.success('Attendance adjusted')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not create adjustment')),
  })
}

export function useCloseSessionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: { dayId: string; reason: string }) =>
      hrAttendanceApi.closeSession(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADJUSTMENTS_KEY] })
      invalidateAll(queryClient)
      toast.success('Session closed')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not close session')),
  })
}

export function useCreateDayMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateAttendanceDayDto) =>
      hrAttendanceApi.createDay(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADJUSTMENTS_KEY] })
      invalidateAll(queryClient)
      toast.success('Attendance day added')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not add attendance day')),
  })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function useAttendanceSettingsQuery() {
  return useQuery({
    queryKey: [SETTINGS_KEY],
    queryFn: () => hrAttendanceApi.getSettings().then((r) => r.data),
  })
}

export function useUpdateAttendanceSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mode: AttendanceMode) =>
      hrAttendanceApi.updateSettings(mode).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] })
      toast.success('Attendance settings saved')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not save settings')),
  })
}

// ---------------------------------------------------------------------------
// Self-service (/hr/my) — powers the global header attendance clock
// ---------------------------------------------------------------------------

const MY_TODAY_KEY = 'hr-my-attendance-today'
const MY_PROFILE_KEY = 'hr-my-profile'

/**
 * Probes whether the logged-in account has an Employee record linked. A 404 is
 * the expected "not an employee" answer, so it resolves to `null` rather than
 * throwing — callers hide the widget on a falsy result.
 */
export function useMyHrProfileQuery(enabled: boolean) {
  return useQuery({
    queryKey: [MY_PROFILE_KEY],
    queryFn: () =>
      hrMyAttendanceApi
        .profile()
        .then((r) => r.data)
        .catch(() => null),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

export function useMyAttendanceTodayQuery(enabled: boolean) {
  return useQuery({
    queryKey: [MY_TODAY_KEY],
    queryFn: () => hrMyAttendanceApi.today().then((r) => r.data),
    enabled,
    // The clock sits on every page; keep it fresh without hammering the API.
    refetchInterval: 30_000,
    retry: false,
  })
}

const MY_ACTION_LABELS: Record<MyAttendanceAction, { success: string; failure: string }> = {
  checkIn: { success: 'Checked in', failure: 'Could not check in' },
  breakStart: { success: 'Break started', failure: 'Could not start break' },
  breakEnd: { success: 'Break ended', failure: 'Could not end break' },
  checkOut: { success: 'Checked out', failure: 'Could not check out' },
}

export type MyAttendanceAction = 'checkIn' | 'breakStart' | 'breakEnd' | 'checkOut'

export function useMyAttendanceActionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: MyAttendanceAction) => {
      const call = {
        checkIn: hrMyAttendanceApi.checkIn,
        breakStart: hrMyAttendanceApi.breakStart,
        breakEnd: hrMyAttendanceApi.breakEnd,
        checkOut: hrMyAttendanceApi.checkOut,
      }[action]
      return call().then((r) => r.data)
    },
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: [MY_TODAY_KEY] })
      invalidateAll(queryClient)
      toast.success(MY_ACTION_LABELS[action].success)
    },
    onError: (e: unknown, action) =>
      toast.error(getErrorMessage(e, MY_ACTION_LABELS[action].failure)),
  })
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export function useDevicesQuery() {
  return useQuery({
    queryKey: [DEVICES_KEY],
    queryFn: () => hrAttendanceApi.listDevices().then((r) => r.data),
  })
}

export function useCreateDeviceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateDeviceDto) =>
      hrAttendanceApi.createDevice(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Device added')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not add device')),
  })
}

export function useUpdateDeviceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateDeviceDto }) =>
      hrAttendanceApi.updateDevice(id, dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Device updated')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not update device')),
  })
}

export function useDeleteDeviceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrAttendanceApi.deleteDevice(id).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Device deleted')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not delete device')),
  })
}

export function useTestDeviceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrAttendanceApi.testDevice(id).then((r) => r.data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: [DEVICES_KEY] })
      if (res.syncStatus === 'CONNECTED') {
        toast.success('Device connection successful')
      } else {
        toast.error(res.error || 'Device connection failed')
      }
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not test connection')),
  })
}

export function useSyncDeviceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrAttendanceApi.syncDevice(id).then((r) => r.data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: [DEVICES_KEY] })
      if (res.syncStatus === 'CONNECTED') {
        toast.success('Device sync completed')
      } else {
        toast.error(res.error || 'Device sync failed')
      }
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not sync device')),
  })
}

export function useDeviceMappingsQuery(deviceId: string | null) {
  return useQuery({
    queryKey: [MAPPINGS_KEY, deviceId ?? ''],
    queryFn: () => hrAttendanceApi.listMappings(deviceId!).then((r) => r.data),
    enabled: !!deviceId,
  })
}

export function useCreateMappingMutation(deviceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: { employeeId: string; deviceEmployeeId: string }) =>
      hrAttendanceApi.createMapping(deviceId, dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MAPPINGS_KEY] })
      queryClient.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Mapping added')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not add mapping')),
  })
}

export function useDeleteMappingMutation(deviceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mappingId: string) =>
      hrAttendanceApi.deleteMapping(deviceId, mappingId).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MAPPINGS_KEY] })
      queryClient.invalidateQueries({ queryKey: [DEVICES_KEY] })
      toast.success('Mapping removed')
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, 'Could not remove mapping')),
  })
}