import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { commissionsApi } from './api'
import type { CommissionRuleV2Input } from './api'

/** Statuses a commission rule may be built against. */
export function useCommissionPurposes() {
  return useQuery({
    queryKey: ['commissions', 'purposes'],
    queryFn: () => commissionsApi.listPurposes(),
    staleTime: 10 * 60 * 1000, // order statuses are effectively static
  })
}

export function useCommissionRulesV2(params?: { employeeId?: string; isActive?: boolean }) {
  return useQuery({
    queryKey: ['commissions', 'rules-v2', params],
    queryFn: () => commissionsApi.listRulesV2(params),
  })
}

export function useCommissionReport(params?: {
  employeeId?: string
  departmentId?: string
  from?: string
  to?: string
}) {
  return useQuery({
    queryKey: ['commissions', 'report', params],
    queryFn: () => commissionsApi.report(params),
  })
}

export function useCommissionByRule(params?: { employeeId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['commissions', 'report-by-rule', params],
    queryFn: () => commissionsApi.reportByRule(params),
  })
}

export function useCommissionDrilldown(
  params: {
    employeeId: string
    purpose?: string
    from?: string
    to?: string
    page?: number
    perPage?: number
  } | null,
) {
  return useQuery({
    queryKey: ['commissions', 'drilldown', params],
    queryFn: () => commissionsApi.drilldown(params!),
    enabled: !!params?.employeeId,
  })
}

export function useEarningDetail(id: string | null) {
  return useQuery({
    queryKey: ['commissions', 'earning', id],
    queryFn: () => commissionsApi.earningDetail(id!),
    enabled: !!id,
  })
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['commissions'] })
}

export function useCreateRuleV2Mutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: CommissionRuleV2Input) => commissionsApi.createRuleV2(dto),
    onSuccess: (rule) => {
      invalidate(queryClient)
      toast.success('Commission rule created')
      return rule
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Could not create the rule')
    },
  })
}

export function useUpdateRuleV2Mutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<CommissionRuleV2Input> & { isActive?: boolean } }) =>
      commissionsApi.updateRuleV2(id, dto),
    onSuccess: () => {
      invalidate(queryClient)
      toast.success('Commission rule updated')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Could not update the rule')
    },
  })
}

export function useSetRuleActiveV2Mutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      commissionsApi.setRuleActiveV2(id, isActive),
    onSuccess: (rule) => {
      invalidate(queryClient)
      // Deactivation never rewrites history, so this is safe to state plainly.
      toast.success(
        rule.isActive
          ? 'Rule reactivated — it applies to future qualifying orders only'
          : 'Rule deactivated — past earnings are unchanged',
      )
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Could not change the rule state')
    },
  })
}

/**
 * End a rule today. Unlike deactivating, this closes the validity window while
 * leaving the rule auditable — so the message must not claim the rule is gone,
 * and must state that today's own earnings are unaffected.
 */
export function useEndRuleV2Mutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => commissionsApi.endRuleV2(id),
    onSuccess: (rule) => {
      invalidate(queryClient)
      toast.success(
        `Rule ended on ${rule.effectiveTo ?? 'today'} — it no longer applies to future orders, and past earnings are unchanged`,
      )
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Could not end the rule')
    },
  })
}

export function usePreviewRuleMutation() {
  return useMutation({
    mutationFn: (dto: CommissionRuleV2Input) => commissionsApi.previewRule(dto),
  })
}

// ── Legacy (v1) mutations, still used by the existing earnings table ─────────

export function useReverseEarningMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: { orderId?: string; reason: string; refundedAmount?: number } }) =>
      commissionsApi.reverseEarning(id, dto).then((r: any) => r.data),
    onSuccess: () => {
      invalidate(queryClient)
      toast.success('Commission reversed')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Could not reverse the commission')
    },
  })
}

/** Legacy v1 earnings list, still used by the earnings/reversal table. */
export function useCommissionEarningsQuery(params: {
  employeeId?: string
  reversed?: string
  inPayroll?: string
  page?: number
  perPage?: number
}) {
  return useQuery({
    queryKey: ['commissions', 'earnings-v1', params],
    queryFn: () => commissionsApi.listEarnings(params).then((r) => r.data),
  })
}
