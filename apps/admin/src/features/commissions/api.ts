import { apiClient } from '@/lib/api-client'

export type CommissionAmountType = 'fixed' | 'percent'
export type ThresholdPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type ValueBasis = 'order_total' | 'subtotal'

/**
 * The operational actions a commission rule can pay for. Kept as a literal
 * union so the UI cannot offer something the backend will reject, and so a
 * typo is a compile error rather than a runtime rejection.
 */
export const COMMISSION_PURPOSES = [
  { value: 'Confirmed', label: 'Confirmed', hint: 'Order confirmed by staff' },
  { value: 'Packed', label: 'Packed', hint: 'Order packed' },
  { value: 'Shipping', label: 'Shipping', hint: 'Order handed to courier' },
  { value: 'Delivered', label: 'Delivered', hint: 'Order delivered to customer' },
  { value: 'Returned', label: 'Returned', hint: 'Order returned by customer' },
  { value: 'Cancelled', label: 'Cancelled', hint: 'Order cancelled' },
] as const

export type CommissionPurpose = (typeof COMMISSION_PURPOSES)[number]['value']

export const THRESHOLD_PERIODS: { value: ThresholdPeriod; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

export const VALUE_BASES: { value: ValueBasis; label: string }[] = [
  { value: 'order_total', label: 'Order total (including delivery)' },
  { value: 'subtotal', label: 'Subtotal (items only)' },
]

export interface CommissionRuleV2 {
  id: string
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  department: string | null
  avatar: string | null
  name: string | null
  purpose: CommissionPurpose
  amountType: CommissionAmountType
  amount: number
  valueBasis: string
  minOrderAmount: number | null
  capPerOrder: number | null
  minimumCount: number | null
  thresholdPeriod: ThresholdPeriod | null
  effectiveFrom: string | null
  effectiveTo: string | null
  isActive: boolean
  createdAt: string
  /** Plain-language explanation, rendered in the UI and stored server-side. */
  summary: string
}

export interface CommissionRuleV2Input {
  employeeId: string
  name?: string | null
  purpose: CommissionPurpose
  amountType: CommissionAmountType
  amount: number
  valueBasis?: ValueBasis
  minOrderAmount?: number | null
  capPerOrder?: number | null
  minimumCount?: number | null
  thresholdPeriod?: ThresholdPeriod | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
}

export interface PurposeStatus {
  id: string
  name: CommissionPurpose
  color: string
}

// ── Reporting ────────────────────────────────────────────────────────────────

export interface CommissionPurposeTotal {
  purpose: string
  amount: number
  count: number
}

export interface CommissionEmployeeTotal {
  employeeId: string
  employeeCode: string | null
  name: string
  avatar: string | null
  department: string | null
  totalEarned: number
  paid: number
  unpaid: number
  earningCount: number
  byPurpose: CommissionPurposeTotal[]
}

export interface CommissionReportResponse {
  data: CommissionEmployeeTotal[]
  totals: {
    totalEarned: number
    totalPaid: number
    totalUnpaid: number
    employeeCount: number
  }
}

export interface CommissionByRuleRow {
  ruleId: string
  ruleName: string | null
  employeeId: string | null
  employeeName: string
  purpose: string
  ruleAmount: number | null
  amountType: CommissionAmountType | null
  amount: number
  count: number
}

export interface CommissionDrilldownRow {
  ledgerId: string
  orderId: string
  displayId: string
  orderTotal: number
  orderStatus: string | null
  purpose: string
  amount: number
  qualifiedAt: string
  status: string
}

export interface CommissionDrilldownResponse {
  data: CommissionDrilldownRow[]
  meta: {
    page: number
    perPage: number
    total: number
    totalPages: number
    totalAmount: number
  }
}

/** Everything needed to answer "why was this paid?". */
export interface CommissionEarningDetail {
  id: string
  employee: { id: string; employeeCode: string; name: string; department: string | null }
  order: { id: string; displayId: string; total: number; subtotal: number; status: string | null }
  purpose: string
  qualification: {
    isFirstActor: boolean
    transitionFrom: string | null
    transitionTo: string | null
    actorUserId: string | null
    qualifiedAt: string
    threshold: {
      required: number
      period: ThresholdPeriod
      countAtQualification: number | null
      periodKey: string
    } | null
  }
  calculation: {
    amountType: CommissionAmountType
    ruleAmountAtTime: number
    valueBasis: string
    sourceAmount: number
    capApplied: boolean
    amount: number
  }
  rule: { id: string; name: string | null; currentAmount: number; isActive: boolean } | null
  status: string
  payslipId: string | null
  reversed: number
  net: number
  reversals: Array<{
    id: string
    amount: number
    reason: string
    refundedAmount: number | null
    reversedAt: string
  }>
  createdAt: string
}

// ── Legacy (v1) shapes, still returned by the existing endpoints ─────────────

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

const unwrap = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const commissionsApi = {
  // ── v2: action-scoped rules ──
  listPurposes: () =>
    apiClient.get<PurposeStatus[]>('/hr/commissions/v2/purposes').then((r) => r.data),

  listRulesV2: (params?: { employeeId?: string; isActive?: boolean }) =>
    unwrap(
      apiClient.get<CommissionRuleV2[]>('/hr/commissions/v2/rules', {
        params: { ...params, isActive: params?.isActive === undefined ? undefined : String(params.isActive) },
      }),
    ),

  getRuleV2: (id: string) => unwrap(apiClient.get<CommissionRuleV2>(`/hr/commissions/v2/rules/${id}`)),

  previewRule: (dto: CommissionRuleV2Input) =>
    apiClient.post<{ summary: string }>('/hr/commissions/v2/rules/preview', dto).then((r) => r.data),

  createRuleV2: (dto: CommissionRuleV2Input) =>
    unwrap(apiClient.post<CommissionRuleV2>('/hr/commissions/v2/rules', dto)),

  updateRuleV2: (id: string, dto: Partial<CommissionRuleV2Input> & { isActive?: boolean }) =>
    unwrap(apiClient.patch<CommissionRuleV2>(`/hr/commissions/v2/rules/${id}`, dto)),

  setRuleActiveV2: (id: string, isActive: boolean) =>
    unwrap(apiClient.post<CommissionRuleV2>(`/hr/commissions/v2/rules/${id}/active`, { isActive })),

  report: (params?: { employeeId?: string; departmentId?: string; from?: string; to?: string }) =>
    unwrap(apiClient.get<CommissionReportResponse>('/hr/commissions/v2/report', { params })),

  reportByRule: (params?: { employeeId?: string; from?: string; to?: string }) =>
    unwrap(
      apiClient.get<{ data: CommissionByRuleRow[] }>('/hr/commissions/v2/report/by-rule', { params }),
    ),

  drilldown: (params: {
    employeeId: string
    purpose?: string
    from?: string
    to?: string
    page?: number
    perPage?: number
  }) =>
    unwrap(apiClient.get<CommissionDrilldownResponse>('/hr/commissions/v2/report/drilldown', { params })),

  earningDetail: (id: string) =>
    unwrap(apiClient.get<CommissionEarningDetail>(`/hr/commissions/v2/earnings/${id}`)),

  // ── v1 legacy endpoints (unchanged) ──
  createRule: (dto: CreateCommissionRuleDto) =>
    apiClient.post<CommissionRule>('/hr/commissions/rules', dto),
  listRules: (params?: { employeeId?: string; isActive?: boolean }) =>
    apiClient.get<CommissionRule[]>('/hr/commissions/rules', { params }),
  updateRule: (id: string, dto: UpdateCommissionRuleDto) =>
    apiClient.patch<CommissionRule>(`/hr/commissions/rules/${id}`, dto),
  setRuleActive: (id: string, isActive: boolean) =>
    apiClient.post<CommissionRule>(`/hr/commissions/rules/${id}/active`, { isActive }),
  deleteRule: (id: string) => apiClient.delete(`/hr/commissions/rules/${id}`),
  listEarnings: (params: {
    employeeId?: string
    reversed?: string
    inPayroll?: string
    page?: number
    perPage?: number
  }) =>
    apiClient.get<CommissionListResponse<CommissionEarningRow>>('/hr/commissions/earnings', {
      params,
    }),
  reverseEarning: (id: string, dto: ReverseEarningDto) =>
    apiClient.post<unknown>(`/hr/commissions/earnings/${id}/reverse`, dto),
}