import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { hrScheduleApi } from './api'

export function useScheduleQuery(employeeId: string) {
  return useQuery({
    queryKey: ['hr-schedule', employeeId],
    queryFn: () => hrScheduleApi.getSchedule(employeeId).then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useHistoryQuery(employeeId: string, page: number) {
  return useQuery({
    queryKey: ['hr-history', employeeId, page],
    queryFn: () =>
      hrScheduleApi.getHistory(employeeId, page).then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useSetScheduleMutation(employeeId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ days, note }: { days: number[]; note?: string }) =>
      hrScheduleApi.setSchedule(employeeId, { days, note }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-schedule', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['hr-history', employeeId] })
      toast.success('Weekly off updated')
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Error saving schedule'),
  })
}