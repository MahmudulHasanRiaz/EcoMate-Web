import { apiClient } from '@/lib/api-client'

export type PayslipStatus =
  | 'draft'
  | 'reviewed'
  | 'approved'
  | 'partially_paid'
  | 'paid'
  | 'cancelled'

export interface PayslipItemResponse {
  id: string
  payslipId: string
  type: 'earnings' | 'deductions'
  label: string
  amount: number
}

export interface PayslipResponse {
  id: string
  employeeId: string
  periodStart: string
  periodEnd: string
  totalEarnings: number
  totalDeductions: number
  netPay: number
  status: PayslipStatus
  generatedAt: string
  paidAt: string | null
  reviewedAt: string | null
  approvedAt: string | null
  periodKey: string | null
  notes: string | null
  items?: PayslipItemResponse[]
  employee?: {
    id: string
    employeeId: string
    betterAuthUser: { name: string; email: string }
  }
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

export interface PayrollPayment {
  id: string
  payslipId: string
  amount: number
  paidAt: string
  method: string | null
  referenceNo: string | null
  note: string | null
}

export type PaymentMethod = 'Cash' | 'Bank' | 'Check' | 'Mobile'

interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface GeneratePayslipDto {
  employeeId: string
  periodStart: string
  periodEnd: string
}

export interface SetPayslipStatusDto {
  status: 'reviewed' | 'approved' | 'cancelled'
}

export interface CreatePaymentDto {
  amount: number
  method?: PaymentMethod
  referenceNo?: string
  note?: string
}

export interface PaymentResult {
  payment: PayrollPayment
  payslip: PayslipResponse
}

export const payrollApi = {
  setSalaryStructure: (data: any) => apiClient.post<SalaryStructureResponse>('/payroll/salary-structure', data),
  getSalaryStructure: (employeeId: string) => apiClient.get<SalaryStructureResponse>(`/payroll/salary-structure/${employeeId}`),

  generatePayslip: (data: GeneratePayslipDto) =>
    apiClient.post<PayslipResponse>('/payroll/payslips/generate', data),

  listPayslips: (params?: {
    employeeId?: string
    periodKey?: string
    page?: number
    perPage?: number
  }) => apiClient.get<PaginatedResponse<PayslipResponse>>('/payroll/payslips', { params }),

  getPayslip: (id: string) => apiClient.get<PayslipResponse>(`/payroll/payslips/${id}`),

  setPayslipStatus: (id: string, data: SetPayslipStatusDto) =>
    apiClient.patch<PayslipResponse>(`/payroll/payslips/${id}/status`, data),

  listPayments: (payslipId: string) =>
    apiClient.get<PayrollPayment[]>(`/payroll/payslips/${payslipId}/payments`),

  createPayment: (payslipId: string, data: CreatePaymentDto) =>
    apiClient.post<PaymentResult>(`/payroll/payslips/${payslipId}/payments`, data),

  deletePayment: (payslipId: string, paymentId: string) =>
    apiClient.delete(`/payroll/payslips/${payslipId}/payments/${paymentId}`),
}
