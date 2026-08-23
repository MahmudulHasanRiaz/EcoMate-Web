import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { departmentsApi } from './api'

export function useDepartmentsQuery() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.list().then((r) => r.data),
  })
  return { data, isLoading, isError, error }
}

export function useDepartmentMutations() {
  const queryClient = useQueryClient()

  const createDepartment = useMutation({
    mutationFn: departmentsApi.create,
    onSuccess: () => {
      toast.success('Department created')
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create department')
    },
  })

  const updateDepartment = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Partial<{ name: string; description: string; isActive: boolean }>
    }) => departmentsApi.update(id, data),
    onSuccess: () => {
      toast.success('Department updated')
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update department')
    },
  })

  const deleteDepartment = useMutation({
    mutationFn: (id: string) => departmentsApi.delete(id),
    onSuccess: () => {
      toast.success('Department deleted')
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete department')
    },
  })

  return { createDepartment, updateDepartment, deleteDepartment }
}