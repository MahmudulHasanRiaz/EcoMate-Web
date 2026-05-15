import { useQuery } from '@tanstack/react-query'
import { customersApi, type CustomersQuery } from './api'

export function useCustomersQuery(query: CustomersQuery) {
  return useQuery({
    queryKey: ['customers', query],
    queryFn: () => customersApi.list(query).then((r) => r.data),
  })
}

export function useCustomerOrderSummary(phone: string | null) {
  return useQuery({
    queryKey: ['customer-order-summary', phone],
    queryFn: () => customersApi.getOrderSummary(phone!).then((r) => r.data),
    enabled: !!phone,
  })
}
