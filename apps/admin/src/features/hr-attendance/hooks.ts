import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  hrAttendanceApi,
  type AttendanceListParams,
  type AttendanceStatus,
  type CreateAttendanceDto,
  type UpdateAttendanceDto,
} from './api'

const LIST_KEY = 'hr-attendance'
const OVERVIEW_KEY = 'hr-attendance-overview'
const HISTORY_KEY = 'hr-attendance-history'

function invalidateKeys(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [LIST_KEY] })
  queryClient.invalidateQueries({ queryKey: [OVERVIEW_KEY] })
  queryClient.invalidateQueries({ queryKey: [HISTORY_KEY] })
}

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

export function useCreateAttendanceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateAttendanceDto) =>
      hrAttendanceApi.createAttendance(dto).then((r) => r.data),
    onSuccess: () => {
      invalidateKeys(queryClient)
      toast.success('Attendance record created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating attendance record'),
  })
}

export function useUpdateAttendanceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateAttendanceDto }) =>
      hrAttendanceApi.updateAttendance(id, dto).then((r) => r.data),
    onSuccess: () => {
      invalidateKeys(queryClient)
      toast.success('Attendance record updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating attendance record'),
  })
}

export function useDailyOverviewQuery(date: string) {
  return useQuery({
    queryKey: [OVERVIEW_KEY, date],
    queryFn: () => hrAttendanceApi.getDailyOverview(date).then((r) => r.data),
    enabled: !!date,
  })
}

export function useAttendanceHistoryQuery(employeeId: string) {
  return useQuery({
    queryKey: [HISTORY_KEY, employeeId],
    queryFn: () => hrAttendanceApi.getAttendanceHistory(employeeId).then((r) => r.data),
    enabled: !!employeeId,
  })
}

export type { AttendanceStatus }