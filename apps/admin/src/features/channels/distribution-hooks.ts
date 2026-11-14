import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { distributionApi } from './distribution-api'

export const DISTRIBUTION_KEYS = {
  availability: (productId: string) => ['distribution', 'availability', productId] as const,
  rules: (storeId?: string) => ['distribution', 'rules', storeId ?? 'all'] as const,
  bulkJob: (productId: string, jobId: string) => ['distribution', 'bulk-job', productId, jobId] as const,
}

export function useProductAvailability(productId: string | null) {
  return useQuery({
    queryKey: productId ? DISTRIBUTION_KEYS.availability(productId) : ['distribution', 'availability', 'none'],
    queryFn: () => distributionApi.getAvailability(productId as string),
    enabled: !!productId,
  })
}

export function useSetAvailability(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ storeId, available }: { storeId: string; available: boolean | null }) =>
      distributionApi.setAvailability(productId, storeId, available),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DISTRIBUTION_KEYS.availability(productId) }),
  })
}

export function useBulkAvailability(productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ action, confirm }: { action: 'all_on' | 'all_off'; confirm?: string }) =>
      distributionApi.bulk(productId, action, confirm),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DISTRIBUTION_KEYS.availability(productId) }),
  })
}

export function useBulkJob(productId: string, jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: jobId ? DISTRIBUTION_KEYS.bulkJob(productId, jobId) : ['distribution', 'bulk-job', 'none'],
    queryFn: () => distributionApi.bulkJob(productId, jobId as string),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status
      return s === 'RUNNING' || s === undefined ? 1000 : false
    },
  })
}

export function useAvailabilityRules(storeId?: string) {
  return useQuery({
    queryKey: DISTRIBUTION_KEYS.rules(storeId),
    queryFn: () => distributionApi.listRules(storeId),
  })
}

export function useUpsertRule(storeId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { categoryId: string; storeId: string; available: boolean; inheritFromParent?: boolean }) =>
      distributionApi.upsertRule(payload.categoryId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISTRIBUTION_KEYS.rules(storeId) })
      queryClient.invalidateQueries({ queryKey: DISTRIBUTION_KEYS.rules(undefined) })
    },
  })
}
