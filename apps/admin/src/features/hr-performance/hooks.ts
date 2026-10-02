import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrPerformanceApi } from './api'
import { toast } from 'sonner'

export function useOrderPerformanceQuery(params: {
  from?: string
  to?: string
  employeeId?: string
  departmentId?: string
  page?: number
  perPage?: number
}) {
  return useQuery({
    queryKey: ['hr-performance', 'orders', params],
    queryFn: () => hrPerformanceApi.getOrderPerformance(params),
  })
}

export function useOrderDrilldownQuery(
  employeeId: string,
  params: { from?: string; to?: string; stage?: string; page?: number; perPage?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ['hr-performance', 'orders', 'drilldown', employeeId, params],
    queryFn: () => hrPerformanceApi.getOrderDrilldown(employeeId, params),
    enabled: enabled && !!employeeId,
  })
}

export function useTaskPerformanceQuery(params: {
  from?: string
  to?: string
  departmentId?: string
  employeeId?: string
  page?: number
  perPage?: number
}) {
  return useQuery({
    queryKey: ['hr-performance', 'tasks', params],
    queryFn: () => hrPerformanceApi.getTaskPerformance(params),
  })
}

export function useBackfillOrderEventsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => hrPerformanceApi.backfillOrderEvents(),
    onSuccess: (data) => {
      toast.success(
        data.hasMore
          ? `Scanned ${data.scanned} orders · inserted ${data.inserted} events — run again to continue`
          : `Scanned ${data.scanned} orders · inserted ${data.inserted} events`,
      )
      queryClient.invalidateQueries({ queryKey: ['hr-performance'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Backfill failed')
    },
  })
}
