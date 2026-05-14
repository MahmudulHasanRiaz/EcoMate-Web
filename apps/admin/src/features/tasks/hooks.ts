import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { tasksApi } from './api'

export function useTasksQuery(query: {
  page?: number
  perPage?: number
  search?: string
  status?: string
  label?: string
  priority?: string
  sort?: string
  order?: string
}) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: () => tasksApi.list(query).then((r) => r.data),
  })
}

export function useTaskMutations() {
  const queryClient = useQueryClient()

  const createTask = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => {
      toast.success('Task created successfully')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create task')
    },
  })

  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      tasksApi.update(id, data),
    onSuccess: () => {
      toast.success('Task updated successfully')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update task')
    },
  })

  const deleteTask = useMutation({
    mutationFn: (id: string) => tasksApi.delete(id),
    onSuccess: () => {
      toast.success('Task deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete task')
    },
  })

  const bulkDeleteTasks = useMutation({
    mutationFn: (ids: string[]) => tasksApi.bulkDelete(ids),
    onSuccess: () => {
      toast.success('Tasks deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  const bulkUpdateTasks = useMutation({
    mutationFn: ({ ids, update }: { ids: string[]; update: any }) =>
      tasksApi.bulkUpdate(ids, update),
    onSuccess: () => {
      toast.success('Tasks updated successfully')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  return { createTask, updateTask, deleteTask, bulkDeleteTasks, bulkUpdateTasks }
}
