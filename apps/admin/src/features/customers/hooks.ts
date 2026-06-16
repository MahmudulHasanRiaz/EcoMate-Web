import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customersApi, blockedIpsApi, type CustomersQuery } from './api'
import { toast } from 'sonner'

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

export function useCustomerDetail(id: string) {
  return useQuery({
    queryKey: ['customer-detail', id],
    queryFn: () => customersApi.getById(id),
  })
}

export function useBlockPhone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => customersApi.blockPhone(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-detail'] })
      toast.success('Phone number blocked')
    },
  })
}

export function useUnblockPhone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => customersApi.unblockPhone(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-detail'] })
      toast.success('Phone number unblocked')
    },
  })
}

export function useBlockedIps() {
  return useQuery({
    queryKey: ['blocked-ips'],
    queryFn: () => blockedIpsApi.list(),
  })
}

export function useBlockIp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { ip: string; reason?: string }) => blockedIpsApi.create(data.ip, data.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-ips'] })
      toast.success('IP blocked')
    },
  })
}

export function useUnblockIp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => blockedIpsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-ips'] })
      toast.success('IP unblocked')
    },
  })
}
