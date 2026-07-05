import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { packingApi } from './api'
import type { HoldFormData } from './types'

const PACKING_KEYS = {
  queue: ['packing', 'queue'] as const,
  stats: ['packing', 'stats'] as const,
  locks: ['packing', 'locks'] as const,
  history: ['packing', 'history'] as const,
}

export function usePackingQueue(search?: string) {
  return useQuery({
    queryKey: [...PACKING_KEYS.queue, search],
    queryFn: () => packingApi.getQueue(search),
    refetchInterval: 15_000,
  })
}

export function usePackingStats(all?: boolean) {
  return useQuery({
    queryKey: [...PACKING_KEYS.stats, all],
    queryFn: () => packingApi.getStats(all),
    refetchInterval: 30_000,
  })
}

export function useActiveLocks() {
  return useQuery({
    queryKey: PACKING_KEYS.locks,
    queryFn: () => packingApi.getLocks(),
    refetchInterval: 30_000,
  })
}

export function usePackingHistory(packerId?: string) {
  return useQuery({
    queryKey: [...PACKING_KEYS.history, packerId],
    queryFn: () => packingApi.getHistory(packerId),
  })
}

export function useOpenOrder() {
  return useMutation({
    mutationFn: (orderId: string) => packingApi.openOrder(orderId),
  })
}

export function useMarkDone() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, verificationMode }: { orderId: string; verificationMode: string }) =>
      packingApi.markDone(orderId, verificationMode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.queue })
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.stats })
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.history })
    },
  })
}

export function useMarkHold() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: HoldFormData }) =>
      packingApi.markHold(orderId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.queue })
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.stats })
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.history })
    },
  })
}

export function useReleaseLock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) => packingApi.releaseLock(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.queue })
    },
  })
}

export function useCheckOrderStatus() {
  return useMutation({
    mutationFn: (code: string) => packingApi.checkOrderStatus(code),
  })
}
