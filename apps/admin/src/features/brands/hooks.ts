import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { brandsApi } from './api'

export const useBrands = (activeOnly?: boolean) => {
  return useQuery({
    queryKey: ['brands', activeOnly],
    queryFn: () => brandsApi.list(activeOnly),
  })
}

export const useCreateBrand = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: brandsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }),
  })
}

export const useUpdateBrand = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => brandsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }),
  })
}

export const useDeleteBrand = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: brandsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }),
  })
}
