import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { storesApi, type CreateStorePayload } from './api'

export const STORES_KEYS = {
  all: ['stores'] as const,
  detail: (id: string) => ['stores', id] as const,
  health: (id: string) => ['stores', id, 'health'] as const,
}

export function useStores() {
  return useQuery({ queryKey: STORES_KEYS.all, queryFn: storesApi.list })
}

export function useStoreDetail(id: string) {
  return useQuery({ queryKey: STORES_KEYS.detail(id), queryFn: () => storesApi.detail(id) })
}

export function useStoreHealth(id: string) {
  return useQuery({ queryKey: STORES_KEYS.health(id), queryFn: () => storesApi.health(id) })
}

export function useCreateStore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateStorePayload) => storesApi.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STORES_KEYS.all }),
  })
}

export function useDisconnectStore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => storesApi.disconnect(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STORES_KEYS.all }),
  })
}
