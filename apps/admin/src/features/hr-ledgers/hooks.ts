import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  hrLedgersApi,
  type CreateEarningDto,
  type CreateDeductionDto,
} from './api'

export function useEarningsQuery({
  employeeId,
  status,
  page,
}: {
  employeeId: string
  status?: string
  page: number
}) {
  return useQuery({
    queryKey: ['hr-earnings', employeeId, status, page],
    queryFn: () =>
      hrLedgersApi
        .listEarnings({ employeeId, status, page, perPage: 20 })
        .then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useDeductionsQuery({
  employeeId,
  status,
  page,
}: {
  employeeId: string
  status?: string
  page: number
}) {
  return useQuery({
    queryKey: ['hr-deductions', employeeId, status, page],
    queryFn: () =>
      hrLedgersApi
        .listDeductions({ employeeId, status, page, perPage: 20 })
        .then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useCreateEarningMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateEarningDto) => hrLedgersApi.createEarning(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-earnings', employeeId] })
      toast.success('Earning added')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding earning'),
  })
}

export function useApproveEarningMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrLedgersApi.approveEarning(id).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-earnings', employeeId] })
      toast.success('Earning approved')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error approving earning'),
  })
}

export function useCreateDeductionMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateDeductionDto) => hrLedgersApi.createDeduction(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-deductions', employeeId] })
      toast.success('Deduction added')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding deduction'),
  })
}

export function useApproveDeductionMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => hrLedgersApi.approveDeduction(id).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-deductions', employeeId] })
      toast.success('Deduction approved')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error approving deduction'),
  })
}
