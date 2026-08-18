import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dispatchApi } from './api'

export function useDispatchList(params?: any) {
  return useQuery({
    queryKey: ['dispatches', params],
    queryFn: () => dispatchApi.list(params).then((r) => r.data),
  })
}

export function useDispatchMetrics() {
  return useQuery({
    queryKey: ['dispatch-metrics'],
    queryFn: () => dispatchApi.getMetrics().then((r) => r.data),
    refetchInterval: 30000,
  })
}

export function useDispatchMutations() {
  const qc = useQueryClient()

  return {
    create: useMutation({
      mutationFn: dispatchApi.create,
      onSuccess: () => {
        toast.success('Dispatch created')
        qc.invalidateQueries({ queryKey: ['dispatches'] })
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.message || 'Failed to create dispatch'),
    }),
    updateStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: string }) =>
        dispatchApi.updateStatus(id, status),
      onSuccess: () => {
        toast.success('Status updated')
        qc.invalidateQueries({ queryKey: ['dispatches'] })
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.message || 'Failed to update dispatch status'),
    }),
    remove: useMutation({
      mutationFn: dispatchApi.remove,
      onSuccess: () => {
        toast.success('Dispatch deleted')
        qc.invalidateQueries({ queryKey: ['dispatches'] })
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.message || 'Failed to delete dispatch'),
    }),
  }
}

export function useDispatchSync() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) =>
      dispatchApi.syncStatus(ids).then((r) => r.data),
    onSuccess: (summary) => {
      const parts = [
        `${summary.synced.length} synced`,
        `${summary.unchanged.length} unchanged`,
      ]
      if (summary.failed.length) {
        parts.push(`${summary.failed.length} failed`)
        toast.warning(`Courier sync: ${parts.join(' · ')}`)
      } else {
        toast.success(`Courier sync: ${parts.join(' · ')}`)
      }
      qc.invalidateQueries({ queryKey: ['dispatches'] })
      qc.invalidateQueries({ queryKey: ['dispatch-metrics'] })
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Failed to sync courier status'),
  })
}
