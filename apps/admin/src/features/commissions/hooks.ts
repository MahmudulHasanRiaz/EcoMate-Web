import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  commissionsApi,
  type CreateCommissionRuleDto,
  type UpdateCommissionRuleDto,
} from './api'

function invalidateRules(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['commission-rules'] })
}

export function useCommissionRulesQuery({
  employeeId,
  isActive,
}: {
  employeeId?: string
  isActive?: boolean
}) {
  return useQuery({
    queryKey: ['commission-rules', employeeId, isActive],
    queryFn: () => commissionsApi.listRules({ employeeId, isActive }).then((r) => r.data),
  })
}

export function useCreateRuleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateCommissionRuleDto) => commissionsApi.createRule(dto).then((r) => r.data),
    onSuccess: () => {
      invalidateRules(queryClient)
      toast.success('Commission rule created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating rule'),
  })
}

export function useUpdateRuleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateCommissionRuleDto }) =>
      commissionsApi.updateRule(id, dto).then((r) => r.data),
    onSuccess: () => {
      invalidateRules(queryClient)
      toast.success('Commission rule updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating rule'),
  })
}

export function useSetRuleActiveMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      commissionsApi.setRuleActive(id, isActive).then((r) => r.data),
    onSuccess: () => {
      invalidateRules(queryClient)
      toast.success('Rule status updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating rule'),
  })
}

export function useDeleteRuleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => commissionsApi.deleteRule(id).then(() => id),
    onSuccess: () => {
      invalidateRules(queryClient)
      toast.success('Commission rule deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting rule'),
  })
}

export function useCommissionEarningsQuery({
  employeeId,
  page,
}: {
  employeeId?: string
  page: number
}) {
  return useQuery({
    queryKey: ['commission-earnings', employeeId, page],
    queryFn: () =>
      commissionsApi
        .listEarnings({ employeeId, page, perPage: 20 })
        .then((r) => r.data),
  })
}
