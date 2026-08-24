import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  hrAttendanceApi,
  getErrorMessage,
  type AttendanceListParams,
  type AttendanceMode,
  type CreateAdjustmentDto,
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