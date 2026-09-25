import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { syncApi, syncPollInterval } from './sync-api'

export const SYNC_KEYS = {
  all: ['sync'] as const,
  runs: ['sync', 'runs'] as const,
  runDetail: (id: string) => ['sync', 'runs', id] as const,
  runItems: (id: string) => ['sync', 'runs', id, 'items'] as const,
  attempts: ['sync', 'attempts'] as const,
  issues: (status?: string) => ['sync', 'issues', status ?? 'all'] as const,
  overrides: (storeId?: string) => ['sync', 'overrides', storeId ?? 'all'] as const,
  productHistory: (storeId: string, productId: string) => ['sync', 'product-history', storeId, productId] as const,
}

/** History polls at 5s while any run is RUNNING, 30s otherwise (§11). */
export function useSyncRuns() {
  const query = useQuery({ queryKey: SYNC_KEYS.runs, queryFn: () => syncApi.runs() })
  const interval = syncPollInterval(query.data)
  return useQuery({
    queryKey: SYNC_KEYS.runs,
    queryFn: () => syncApi.runs(),
    refetchInterval: interval,
  })
}

export function useSyncRunDetail(id: string) {
  return useQuery({ queryKey: SYNC_KEYS.runDetail(id), queryFn: () => syncApi.runDetail(id), enabled: !!id })
}

export function useSyncIssues(status?: string) {
  return useQuery({ queryKey: SYNC_KEYS.issues(status), queryFn: () => syncApi.issues(status ? { status } : {}) })
}

export function useSyncAttempts(params?: { storeId?: string; status?: string }) {
  return useQuery({
    queryKey: ['sync', 'attempts', params?.storeId ?? 'all', params?.status ?? 'all'] as const,
    queryFn: () =>
      syncApi.attempts({
        ...(params?.storeId ? { storeId: params.storeId } : {}),
        ...(params?.status ? { status: params.status } : {}),
      }),
  })
}

export function useStoreHealthGrid() {
  return useQuery({ queryKey: ['sync', 'health'] as const, queryFn: () => syncApi.healthGrid() })
}

export function useOverridesHistory(storeId?: string) {
  return useQuery({
    queryKey: ['sync', 'overrides', 'history', storeId ?? 'all'] as const,
    queryFn: () => syncApi.overridesHistory(storeId),
  })
}

export function useRetentionStatus() {
  return useQuery({ queryKey: ['sync', 'retention'] as const, queryFn: () => syncApi.retentionStatus() })
}

export function useSyncOverrides(storeId?: string) {
  return useQuery({ queryKey: SYNC_KEYS.overrides(storeId), queryFn: () => syncApi.overrides(storeId) })
}

export function useTriggerStoreSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ storeId, scope }: { storeId: string; scope?: string }) => syncApi.triggerStoreSync(storeId, scope),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs }),
  })
}

export function useSyncAll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (scope?: string) => syncApi.syncAll(scope),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs }),
  })
}

export function useForceEcoMate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ storeId, productId, fields }: { storeId: string; productId: string; fields: string[] }) =>
      syncApi.forceEcoMate(storeId, productId, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync'] })
      queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
  })
}

export function useKeepExternal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ storeId, productId, fields }: { storeId: string; productId: string; fields: string[] }) =>
      syncApi.keepExternal(storeId, productId, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync'] })
      queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
  })
}

export function useRetryOverrides() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (overrideIds: string[]) => syncApi.retryOverrides(overrideIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  })
}

export function useResolveIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note, ignore }: { id: string; note?: string; ignore?: boolean }) =>
      ignore ? syncApi.ignoreIssue(id, note) : syncApi.resolveIssue(id, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  })
}

export function useRetryAttempt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => syncApi.retryAttempt(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  })
}

export function useRetryAttempts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (attemptIds: string[]) => syncApi.retryAttempts(attemptIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  })
}

export function useRetryAllAttempts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (storeId?: string) => syncApi.retryAllAttempts(storeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  })
}

export function useIgnoreAttempt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => syncApi.ignoreAttempt(id, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  })
}

export function useTriggerRetentionPurge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncApi.triggerRetentionPurge(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  })
}
