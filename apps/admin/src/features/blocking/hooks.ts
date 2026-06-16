import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { blockedEntriesApi, blockSettingsApi } from './api'

export function useBlockedEntries(type?: string, search?: string) {
  return useQuery({
    queryKey: ['blocked-entries', type, search],
    queryFn: () => blockedEntriesApi.list(type, search),
  })
}

export function useBlockEntryMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['blocked-entries'] })

  return {
    create: useMutation({
      mutationFn: (data: { type: 'ip' | 'phone'; value: string; reason?: string; blockType?: string }) =>
        blockedEntriesApi.create(data),
      onSuccess: invalidate,
    }),
    unblock: useMutation({
      mutationFn: ({ type, id }: { type: string; id: string }) =>
        blockedEntriesApi.unblock(type, id),
      onSuccess: invalidate,
    }),
    whitelist: useMutation({
      mutationFn: ({ type, id }: { type: string; id: string }) =>
        blockedEntriesApi.toggleWhitelist(type, id),
      onSuccess: invalidate,
    }),
  }
}

export function useBlockSettings() {
  return useQuery({
    queryKey: ['block-settings'],
    queryFn: () => blockSettingsApi.get(),
  })
}

export function useUpdateBlockSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => blockSettingsApi.update(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['block-settings'] }),
  })
}
