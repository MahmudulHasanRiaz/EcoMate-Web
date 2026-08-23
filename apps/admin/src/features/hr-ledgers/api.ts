import { apiClient } from '@/lib/api-client'

export type EarningType = 'bonus' | 'incentive' | 'commission' | 'other'
export type DeductionType = 'fine' | 'other'
export type LedgerStatus = 'draft' | 'approved' | 'paid'

export interface EarningRow {
  id: string
  employeeId: string
  type: EarningType
  amount: number
  reason: string
  applicableFrom: string | null
  applicableTo: string | null
  status: LedgerStatus
  payslipId: string | null
  createdAt: string
}

export interface DeductionRow {
  id: string
  employeeId: string
  type: DeductionType
  amount: number
  reason: string
  applicableFrom: string | null
  applicableTo: string | null
  status: LedgerStatus
  payslipId: string | null
  createdAt: string
}

export interface LedgerListResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface CreateEarningDto {
  employeeId: string
  type: EarningType
  amount: number
  reason: string
  applicableFrom?: string
  applicableTo?: string
}

export interface CreateDeductionDto {
  employeeId: string
  type: DeductionType
  amount: number
  reason: string
  applicableFrom?: string
  applicableTo?: string
}

export const hrLedgersApi = {
  createEarning: (dto: CreateEarningDto) => apiClient.post<EarningRow>('/hr/earnings', dto),
  listEarnings: (params: { employeeId: string; status?: string; page?: number; perPage?: number }) =>
    apiClient.get<LedgerListResponse<EarningRow>>('/hr/earnings', { params }),
  approveEarning: (id: string) => apiClient.post<EarningRow>(`/hr/earnings/${id}/approve`),
  createDeduction: (dto: CreateDeductionDto) => apiClient.post<DeductionRow>('/hr/deductions', dto),
  listDeductions: (params: { employeeId: string; status?: string; page?: number; perPage?: number }) =>
    apiClient.get<LedgerListResponse<DeductionRow>>('/hr/deductions', { params }),
  approveDeduction: (id: string) => apiClient.post<DeductionRow>(`/hr/deductions/${id}/approve`),
}
