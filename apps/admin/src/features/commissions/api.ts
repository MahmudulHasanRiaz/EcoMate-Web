import { apiClient } from '@/lib/api-client'

export type CommissionAmountType = 'fixed' | 'percent'

export interface CommissionRuleEmployee {
  employeeId: string
  betterAuthUser: { name: string }
}

export interface CommissionRule {
  id: string
  employeeId: string
  employee: CommissionRuleEmployee
  amountType: CommissionAmountType
  amount: number
  triggerStatusId: string | null
  minOrderAmount: number | null
  capPerOrder: number | null
  isActive: boolean
  createdAt: string
}

export interface CommissionEarningRow {
  id: string
  employeeId: string
  ruleId: string
  orderId: string
  amount: number
  status: 'approved'
  payslipId?: string | null
  createdAt: string
  employee?: { id: string; employeeId: string } | null
  rule?: {
    id: string
    amountType: CommissionAmountType
    amount: number
  } | null
  order: { id: string; displayId?: string | null; total?: number | null } | null
  reversals?: {
    id: string
    amount: number
    reason: string
    reversedAt?: string | null
    reversedById?: string | null
  }[]
}

export interface CommissionEarningsTotals {
  totalCommission: number
  totalReversed: number
  netPayable: number
}

export interface CommissionListResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
    totals?: CommissionEarningsTotals
  }
}

export interface ReverseEarningDto {
  orderId?: string
  reason: string
  refundedAmount?: number
}

export interface CreateCommissionRuleDto {
  employeeId: string
  amountType: CommissionAmountType
  amount: number
  triggerStatusId?: string | null
  minOrderAmount?: number
  capPerOrder?: number
}

export type UpdateCommissionRuleDto = Partial<Omit<CreateCommissionRuleDto, 'employeeId'>>

export const commissionsApi = {
  createRule: (dto: CreateCommissionRuleDto) =>
    apiClient.post<CommissionRule>('/hr/commissions/rules', dto),
  listRules: (params?: { employeeId?: string; isActive?: boolean }) =>
    apiClient.get<CommissionRule[]>('/hr/commissions/rules', { params }),
  updateRule: (id: string, dto: UpdateCommissionRuleDto) =>
    apiClient.patch<CommissionRule>(`/hr/commissions/rules/${id}`, dto),
  setRuleActive: (id: string, isActive: boolean) =>
    apiClient.post<CommissionRule>(`/hr/commissions/rules/${id}/active`, { isActive }),
  deleteRule: (id: string) =>
    apiClient.delete(`/hr/commissions/rules/${id}`),
  listEarnings: (params: {
    employeeId?: string
    reversed?: string
    inPayroll?: string
    page?: number
    perPage?: number
  }) =>
    apiClient.get<CommissionListResponse<CommissionEarningRow>>(
      '/hr/commissions/earnings',
      { params },
    ),
  reverseEarning: (id: string, dto: ReverseEarningDto) =>
    apiClient.post<unknown>(`/hr/commissions/earnings/${id}/reverse`, dto),
}
