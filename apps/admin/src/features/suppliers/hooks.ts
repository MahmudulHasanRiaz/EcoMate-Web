import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { suppliersApi } from './api'

export const useSuppliers = (activeOnly?: boolean) => {
  return useQuery({
    queryKey: ['suppliers', activeOnly],
    queryFn: () => suppliersApi.list(activeOnly),
  })
}

export const useCreateSupplier = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: suppliersApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  })
}

export const useUpdateSupplier = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => suppliersApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  })
}

export const useDeleteSupplier = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: suppliersApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  })
}
