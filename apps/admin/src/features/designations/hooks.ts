import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { designationsApi } from './api'

export function useDesignationsQuery() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['designations'],
    queryFn: () => designationsApi.list().then((r) => r.data),
  })
  return { data, isLoading, isError, error }
}

export function useDesignationMutations() {
  const queryClient = useQueryClient()

  const createDesignation = useMutation({
    mutationFn: designationsApi.create,
    onSuccess: () => {
      toast.success('Designation created')
      queryClient.invalidateQueries({ queryKey: ['designations'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create designation')
    },
  })

  const updateDesignation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; level: number; isActive: boolean }> }) =>
      designationsApi.update(id, data),
    onSuccess: () => {
      toast.success('Designation updated')
      queryClient.invalidateQueries({ queryKey: ['designations'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update designation')
    },
  })

  const deleteDesignation = useMutation({
    mutationFn: (id: string) => designationsApi.delete(id),
    onSuccess: () => {
      toast.success('Designation deleted')
      queryClient.invalidateQueries({ queryKey: ['designations'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete designation')
    },
  })

  return { createDesignation, updateDesignation, deleteDesignation }
}
