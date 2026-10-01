import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { myProfileApi, type CreateMyLeaveRequestDto } from './api'

export function useMyProfileQuery() {
  return useQuery({
    queryKey: ['my-profile'],
    queryFn: () => myProfileApi.getProfile().then((r) => r.data),
    staleTime: 60 * 1000,
  })
}

export function useMyPerformanceQuery() {
  return useQuery({
    queryKey: ['my-performance'],
    queryFn: () => myProfileApi.getPerformance().then((r) => r.data),
    staleTime: 30 * 1000,
  })
}

export function useMyLeaveBalancesQuery() {
  return useQuery({
    queryKey: ['my-leave-balances'],
    queryFn: () => myProfileApi.getLeaveBalances().then((r) => r.data),
    staleTime: 60 * 1000,
  })
}

export function useMyLeaveTypesQuery() {
  return useQuery({
    queryKey: ['my-leave-types'],
    queryFn: () => myProfileApi.getLeaveTypes().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })
}

export function useMyLeaveRequestsQuery(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['my-leave-requests', page, perPage],
    queryFn: () => myProfileApi.getLeaveRequests(page, perPage).then((r) => r.data),
    staleTime: 30 * 1000,
  })
}

export function useCreateMyLeaveRequestMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateMyLeaveRequestDto) => myProfileApi.createLeaveRequest(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-leave-requests'] })
      queryClient.invalidateQueries({ queryKey: ['my-leave-balances'] })
      queryClient.invalidateQueries({ queryKey: ['my-performance'] })
      toast.success('Leave request submitted successfully')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to submit leave request'
      toast.error(Array.isArray(msg) ? msg.join(', ') : msg)
    },
  })
}

export function useCancelMyLeaveRequestMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => myProfileApi.cancelLeaveRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-leave-requests'] })
      queryClient.invalidateQueries({ queryKey: ['my-leave-balances'] })
      queryClient.invalidateQueries({ queryKey: ['my-performance'] })
      toast.success('Leave request cancelled')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to cancel leave request')
    },
  })
}

export function useMyAttendanceTodayQuery() {
  return useQuery({
    queryKey: ['my-attendance-today'],
    queryFn: () => myProfileApi.getTodayAttendance().then((r) => r.data),
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
  })
}

export function useMyAttendanceHistoryQuery(from?: string, to?: string) {
  return useQuery({
    queryKey: ['my-attendance-history', from, to],
    queryFn: () => myProfileApi.getAttendanceHistory(from, to).then((r) => r.data),
    staleTime: 60 * 1000,
  })
}

export function useMyCheckInMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note?: string) => myProfileApi.checkIn(note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-attendance-today'] })
      queryClient.invalidateQueries({ queryKey: ['my-attendance-history'] })
      queryClient.invalidateQueries({ queryKey: ['my-performance'] })
      toast.success('Checked in successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to check in')
    },
  })
}

export function useMyBreakStartMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => myProfileApi.breakStart(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-attendance-today'] })
      toast.success('Break started')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to start break')
    },
  })
}

export function useMyBreakEndMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => myProfileApi.breakEnd(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-attendance-today'] })
      toast.success('Break ended')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to end break')
    },
  })
}

export function useMyCheckOutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note?: string) => myProfileApi.checkOut(note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-attendance-today'] })
      queryClient.invalidateQueries({ queryKey: ['my-attendance-history'] })
      queryClient.invalidateQueries({ queryKey: ['my-performance'] })
      toast.success('Checked out successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to check out')
    },
  })
}

export function useMySalaryQuery() {
  return useQuery({
    queryKey: ['my-salary'],
    queryFn: () => myProfileApi.getSalary().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })
}

export function useMyPayslipsQuery(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['my-payslips', page, perPage],
    queryFn: () => myProfileApi.getPayslips(page, perPage).then((r) => r.data),
    staleTime: 60 * 1000,
  })
}

export function useMyCommissionsQuery(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['my-commissions', page, perPage],
    queryFn: () => myProfileApi.getCommissions(page, perPage).then((r) => r.data),
    staleTime: 60 * 1000,
  })
}

export function useMyEarningsQuery(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['my-earnings', page, perPage],
    queryFn: () => myProfileApi.getEarnings(page, perPage).then((r) => r.data),
    staleTime: 60 * 1000,
  })
}

export function useMyDeductionsQuery(page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['my-deductions', page, perPage],
    queryFn: () => myProfileApi.getDeductions(page, perPage).then((r) => r.data),
    staleTime: 60 * 1000,
  })
}

export function useMyScheduleQuery() {
  return useQuery({
    queryKey: ['my-schedule'],
    queryFn: () => myProfileApi.getSchedule().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })
}
