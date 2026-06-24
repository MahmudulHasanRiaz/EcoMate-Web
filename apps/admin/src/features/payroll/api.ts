import { apiClient } from '@/lib/api-client'

export interface PayslipResponse {
  id: string
  employeeId: string
  periodStart: string
  periodEnd: string
  totalEarnings: number
  totalDeductions: number
  netPay: number
  status: string
  generatedAt: string
  paidAt: string | null
  notes: string | null
  items?: PayslipItemResponse[]
  employee?: { id: string; firstName: string; lastName: string; employeeId: string }
}

export interface PayslipItemResponse {
  id: string
  payslipId: string
  type: string
  label: string
  amount: number
}

export interface SalaryStructureResponse {
  id: string
  employeeId: string
  basicSalary: number
  houseAllowance: number
  medicalAllowance: number
  transportAllowance: number
  otherAllowance: number
  taxDeduction: number
  insuranceDeduction: number
  otherDeduction: number
  totalEarnings: number
  totalDeductions: number
  netSalary: number
  effectiveFrom: string
  isActive: boolean
}

interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const payrollApi = {
  setSalaryStructure: (data: any) => apiClient.post<SalaryStructureResponse>('/payroll/salary-structure', data),
  getSalaryStructure: (employeeId: string) => apiClient.get<SalaryStructureResponse>(`/payroll/salary-structure/${employeeId}`),
  generatePayslip: (data: any) => apiClient.post<PayslipResponse>('/payroll/payslips/generate', data),
  listPayslips: (params?: any) => apiClient.get<PaginatedResponse<PayslipResponse>>('/payroll/payslips', { params }),
  getPayslip: (id: string) => apiClient.get<PayslipResponse>(`/payroll/payslips/${id}`),
  approvePayslip: (id: string) => apiClient.patch(`/payroll/payslips/${id}/approve`),
}
