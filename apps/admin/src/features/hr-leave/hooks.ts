import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  hrLeaveApi,
  type CreateLeaveTypeDto,
  type UpdateLeaveTypeDto,
  type CreateLeaveRequestDto,
  type LeaveStatus,
} from './api'

function invalidate(queryClient: ReturnType<typeof useQueryClient>, key: string[]) {
  queryClient.invalidateQueries({ queryKey: key })
}

// ===== Leave Types =====
export function useLeaveTypesQuery({ isActive }: { isActive?: boolean } = {}) {
  return useQuery({
    queryKey: ['leave-types', isActive],
    queryFn: () => hrLeaveApi.listTypes({ isActive }).then((r) => r.data),
  })
}

export function useCreateTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateLeaveTypeDto) => hrLeaveApi.createType(dto).then((r) => r.data),
    onSuccess: () => {
      invalidate(queryClient, ['leave-types'])
      toast.success('Leave type created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating leave type'),
  })
}

export function useUpdateTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateLeaveTypeDto }) =>
      hrLeaveApi.updateType(id, dto).then((r) => r.data),
    onSuccess: () => {
      invalidate(queryClient, ['leave-types'])
      toast.success('Leave type updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating leave type'),
  })
}

export function useDeleteTypeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrLeaveApi.deleteType(id).then(() => id),
    onSuccess: () => {
      invalidate(queryClient, ['leave-types'])
      toast.success('Leave type deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting leave type'),
  })
}

// ===== Leave Requests =====
export function useLeaveRequestsQuery({
  employeeId,
  status,
  page,
  perPage = 20,
}: {
  employeeId?: string
  status?: LeaveStatus
  page: number
  perPage?: number
}) {
  return useQuery({
    queryKey: ['leave-requests', employeeId, status, page, perPage],
    queryFn: () =>
      hrLeaveApi
        .listRequests({ employeeId, status, page, perPage })
        .then((r) => r.data),
  })
}

export function useCreateRequestMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateLeaveRequestDto) => hrLeaveApi.createRequest(dto).then((r) => r.data),
    onSuccess: () => {
      invalidate(queryClient, ['leave-requests'])
      toast.success('Leave request created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating leave request'),
  })
}

export function useApproveRequestMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, decisionNote }: { id: string; decisionNote?: string }) =>
      hrLeaveApi.approveRequest(id, decisionNote).then((r) => r.data),
    onSuccess: () => {
      invalidate(queryClient, ['leave-requests'])
      toast.success('Leave request approved')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error approving request'),
  })
}

export function useRejectRequestMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, decisionNote }: { id: string; decisionNote: string }) =>
      hrLeaveApi.rejectRequest(id, decisionNote).then((r) => r.data),
    onSuccess: () => {
      invalidate(queryClient, ['leave-requests'])
      toast.success('Leave request rejected')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error rejecting request'),
  })
}

export function useCancelRequestMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrLeaveApi.cancelRequest(id).then((r) => r.data),
    onSuccess: () => {
      invalidate(queryClient, ['leave-requests'])
      toast.success('Leave request cancelled')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error cancelling request'),
  })
}

// ===== Balances =====
export function useBalancesQuery(employeeId?: string) {
  return useQuery({
    queryKey: ['leave-balances', employeeId],
    queryFn: () => hrLeaveApi.getBalances(employeeId!).then((r) => r.data),
    enabled: !!employeeId,
  })
}

// ===== Calendar =====
export function useCalendarQuery({
  employeeId,
  year,
  month,
}: {
  employeeId?: string
  year: number
  month: number
}) {
  return useQuery({
    queryKey: ['leave-calendar', employeeId, year, month],
    queryFn: () => hrLeaveApi.getCalendar({ employeeId, year, month }).then((r) => r.data),
    enabled: !!employeeId,
  })
}
