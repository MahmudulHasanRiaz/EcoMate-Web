import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { accessPresetsApi } from './api'

export function useAccessPresetsQuery(page: number, search?: string) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['access-presets', page, search],
    queryFn: () => accessPresetsApi.list(page, 20, search).then((r) => r.data),
  })
  return { data, isLoading, isError, error }
}

export function useAccessPresetMutations() {
  const queryClient = useQueryClient()

  const createPreset = useMutation({
    mutationFn: accessPresetsApi.create,
    onSuccess: () => {
      toast.success('Access preset created')
      queryClient.invalidateQueries({ queryKey: ['access-presets'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create access preset')
    },
  })

  const updatePreset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; description?: string; permissions: string[] }> }) =>
      accessPresetsApi.update(id, data),
    onSuccess: () => {
      toast.success('Access preset updated')
      queryClient.invalidateQueries({ queryKey: ['access-presets'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update access preset')
    },
  })

  const deletePreset = useMutation({
    mutationFn: (id: string) => accessPresetsApi.delete(id),
    onSuccess: () => {
      toast.success('Access preset deleted')
      queryClient.invalidateQueries({ queryKey: ['access-presets'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete access preset')
    },
  })

  return { createPreset, updatePreset, deletePreset }
}
