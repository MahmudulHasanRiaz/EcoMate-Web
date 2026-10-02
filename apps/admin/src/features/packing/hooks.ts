import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { packingApi } from './api'
import type { HoldFormData } from './types'

const PACKING_KEYS = {
  queue: ['packing', 'queue'] as const,
  stats: ['packing', 'stats'] as const,
  locks: ['packing', 'locks'] as const,
  history: ['packing', 'history'] as const,
}

/** The queue page: the shared photo catalog plus its orders. */
export function usePackingQueuePage(search?: string) {
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

/**
 * Loads one order's full detail. The queue page is capped, so an order the
 * packer opens by scanning/typing may not be in the polled page; this fetches
 * it directly instead of synthesising an empty order.
 */
export function useOrderDetail() {
  return useMutation({
    mutationFn: (orderId: string) => packingApi.getOrderDetail(orderId),
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
