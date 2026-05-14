import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usersApi, type UsersQuery } from './api'

export function useUsersQuery(query: UsersQuery) {
  return useQuery({
    queryKey: ['users', query],
    queryFn: () => usersApi.list(query).then((r) => r.data),
  })
}

export function useUserMutations() {
  const queryClient = useQueryClient()

  const createUser = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      toast.success('User created successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create user')
    },
  })

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      toast.success('User updated successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update user')
    },
  })

  const deleteUser = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      toast.success('User deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete user')
    },
  })

  const bulkDeleteUsers = useMutation({
    mutationFn: (ids: string[]) => usersApi.bulkDelete(ids),
    onSuccess: (_data, ids) => {
      toast.success(`${ids.length} users deleted successfully`)
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete users')
    },
  })

  const bulkUpdateUsers = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      usersApi.bulkUpdate(ids, status),
    onSuccess: () => {
      toast.success('Users updated successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update users')
    },
  })

  return { createUser, updateUser, deleteUser, bulkDeleteUsers, bulkUpdateUsers }
}
