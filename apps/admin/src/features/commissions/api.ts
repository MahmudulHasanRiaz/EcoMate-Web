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
  createdAt: string
  order: { id: string; displayId?: string | null } | null
}

export interface CommissionListResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
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
  listEarnings: (params: { employeeId?: string; page?: number; perPage?: number }) =>
    apiClient.get<CommissionListResponse<CommissionEarningRow>>('/hr/commissions/earnings', { params }),
}
