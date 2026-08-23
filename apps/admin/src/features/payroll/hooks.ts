import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  payrollApi,
  type SalaryStructureResponse,
  type PayslipResponse,
  type PayslipStatus,
  type PayrollPayment,
  type GeneratePayslipDto,
  type SetPayslipStatusDto,
  type CreatePaymentDto,
} from './api'

export function useSalaryStructureQuery(employeeId: string) {
  return useQuery({
    queryKey: ['salary-structure', employeeId],
    queryFn: async (): Promise<SalaryStructureResponse | null> => {
      try {
        const res = await payrollApi.getSalaryStructure(employeeId)
        return res.data
      } catch (e: any) {
        if (e?.response?.status === 404) return null
        throw e
      }
    },
    enabled: !!employeeId,
  })
}

export function useSetSalaryStructureMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: any) => payrollApi.setSalaryStructure(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structure', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['salary-history', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['payroll-summary', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      toast.success('Salary structure saved')
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Error saving salary structure'),
  })
}

export function useSalaryStructureHistoryQuery(employeeId: string) {
  return useQuery({
    queryKey: ['salary-history', employeeId],
    queryFn: () =>
      payrollApi
        .getSalaryStructureHistory(employeeId)
        .then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function usePayrollSummaryQuery(employeeId: string) {
  return useQuery({
    queryKey: ['payroll-summary', employeeId],
    queryFn: () => payrollApi.getPayrollSummary(employeeId).then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function usePayslipsQuery({
  employeeId,
  periodKey,
  page = 1,
}: {
  employeeId?: string
  periodKey?: string
  page?: number
}) {
  return useQuery({
    queryKey: ['payslips', employeeId, periodKey, page],
    queryFn: () =>
      payrollApi
        .listPayslips({ employeeId, periodKey, page, perPage: 20 })
        .then((r) => r.data),
    enabled: !!employeeId,
  })
}

export function useGeneratePayslipMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: GeneratePayslipDto) => payrollApi.generatePayslip(dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips', employeeId] })
      toast.success('Payslip generated')
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message
      toast.error(msg || 'Error generating payslip')
      if (e?.response?.status !== 409) throw e
    },
  })
}

export function useSetPayslipStatusMutation(employeeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: SetPayslipStatusDto['status'] }) =>
      payrollApi.setPayslipStatus(id, { status }).then((r) => r.data),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payslips', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['payslip', vars.id] })
      toast.success(`Payslip marked ${vars.status}`)
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Error updating payslip'),
  })
}

export function usePayslipQuery(id: string) {
  return useQuery({
    queryKey: ['payslip', id],
    queryFn: () => payrollApi.getPayslip(id).then((r) => r.data),
    enabled: !!id,
  })
}

export function usePaymentsQuery(payslipId: string) {
  return useQuery({
    queryKey: ['payroll-payments', payslipId],
    queryFn: () => payrollApi.listPayments(payslipId).then((r) => r.data),
    enabled: !!payslipId,
  })
}

export function useCreatePaymentMutation(employeeId: string, payslipId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreatePaymentDto) => payrollApi.createPayment(payslipId, dto).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-payments', payslipId] })
      queryClient.invalidateQueries({ queryKey: ['payslip', payslipId] })
      queryClient.invalidateQueries({ queryKey: ['payslips', employeeId] })
      toast.success('Payment recorded')
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Error recording payment'),
  })
}

export function useDeletePaymentMutation(employeeId: string, payslipId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => payrollApi.deletePayment(payslipId, paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-payments', payslipId] })
      queryClient.invalidateQueries({ queryKey: ['payslip', payslipId] })
      queryClient.invalidateQueries({ queryKey: ['payslips', employeeId] })
      toast.success('Payment reversed')
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Error reversing payment'),
  })
}

export type { PayslipResponse, PayslipStatus, PayrollPayment }
