import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { payrollApi, type SalaryStructureResponse } from './api'

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
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] })
      toast.success('Salary structure saved')
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Error saving salary structure'),
  })
}
