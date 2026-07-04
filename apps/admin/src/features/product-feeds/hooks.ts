import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feedApi } from './api'

const FEED_KEYS = {
  configs: ['feed-configs'] as const,
  logs: ['feed-logs'] as const,
}

export function useFeedConfigs() {
  return useQuery({
    queryKey: FEED_KEYS.configs,
    queryFn: () => feedApi.listConfigs(),
  })
}

export function useFeedLogs(platform?: string) {
  return useQuery({
    queryKey: [...FEED_KEYS.logs, platform],
    queryFn: () => feedApi.getLogs(platform),
  })
}

export function useCreateFeedConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { platform: string }) => feedApi.createConfig(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEYS.configs }),
  })
}

export function useUpdateFeedConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => feedApi.updateConfig(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEYS.configs }),
  })
}

export function useRegenerateToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => feedApi.regenerateToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEYS.configs }),
  })
}
