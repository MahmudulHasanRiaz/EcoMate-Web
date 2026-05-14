import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { productsApi } from './api'

export function useProductsQuery(query: {
  page?: number
  perPage?: number
  search?: string
  sort?: string
  order?: string
}) {
  return useQuery({
    queryKey: ['products', query],
    queryFn: () => productsApi.list(query).then((r) => r.data),
  })
}

export function useProductMutations() {
  const queryClient = useQueryClient()

  const createProduct = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      toast.success('Product created successfully')
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create product')
    },
  })

  const updateProduct = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      toast.success('Product updated successfully')
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update product')
    },
  })

  const deleteProduct = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      toast.success('Product deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete product')
    },
  })

  return { createProduct, updateProduct, deleteProduct }
}
