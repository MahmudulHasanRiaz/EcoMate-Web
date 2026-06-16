import { useQuery } from '@tanstack/react-query'
import { customersApi, type CustomersQuery } from './api'

export function useCustomersQuery(query: CustomersQuery) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['customers', query],
    queryFn: () => customersApi.list(query).then((r) => r.data),
  })
  return { data, isLoading, isError, error }
}

export function useCustomerOrderSummary(phone: string | null) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['customer-order-summary', phone],
    queryFn: () => customersApi.getOrderSummary(phone!).then((r) => r.data),
    enabled: !!phone,
  })
  return { data, isLoading, isError, error }
}
