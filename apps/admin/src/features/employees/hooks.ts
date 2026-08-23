import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  employeesApi,
  getEmployee,
  updateEmployee,
  type CreateBankAccountDto,
  type UpdateEmployeeDto,
} from './api'

function toastError(error: unknown, fallback: string) {
  const message = (error as any)?.response?.data?.message
  const text = Array.isArray(message) ? message.join(', ') : typeof message === 'string' ? message : fallback
  toast.error(text)
}

export function useEmployeeQuery(id: string) {
  return useQuery({
    queryKey: ['employee', id],
    queryFn: () => getEmployee(id),
    enabled: !!id,
  })
}

export function useUpdateEmployeeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateEmployeeDto }) =>
      updateEmployee(id, dto),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['employee', variables.id] })
      toast.success('Employee updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating employee'),
  })
}

export function useBankAccountsQuery(employeeId: string) {
  return useQuery({
    queryKey: ['bank-accounts', employeeId],
    queryFn: () => employeesApi.listBankAccounts(employeeId).then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useCreateBankAccountMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateBankAccountDto) =>
      employeesApi.createBankAccount(employeeId, dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      toast.success('Bank account added')
    },
    onError: (e: any) => toastError(e, 'Error adding bank account'),
  })
}

export function useUpdateBankAccountMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<CreateBankAccountDto> }) =>
      employeesApi.updateBankAccount(id, dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      toast.success('Bank account updated')
    },
    onError: (e: any) => toastError(e, 'Error updating bank account'),
  })
}

export function useDeleteBankAccountMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => employeesApi.deleteBankAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      toast.success('Bank account deleted')
    },
    onError: (e: any) => toastError(e, 'Error deleting bank account'),
  })
}

export function useSetPrimaryBankAccountMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => employeesApi.setPrimaryBankAccount(id).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      toast.success('Primary bank account updated')
    },
    onError: (e: any) => toastError(e, 'Error updating primary bank account'),
  })
}