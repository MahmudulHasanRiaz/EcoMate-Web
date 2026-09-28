import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { courierSettlementApi } from './api'

const err = (e: any) =>
  e?.response?.data?.message ||
  e?.response?.data?.error ||
  e?.message ||
  'Request failed'

// Every endpoint returns the payload directly (no {data} envelope except
// `GET /invoices`, which carries {data, meta}) — unwrapping happens here so
// the components only ever see the typed read model.

export function useOverview(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['cs-overview', params],
    queryFn: () => courierSettlementApi.overview(params).then((r) => r.data),
  })
}

export function useInvoices(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['cs-invoices', params],
    queryFn: () => courierSettlementApi.invoices(params).then((r) => r.data),
  })
}

export function useBalances(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['cs-balances', params],
    queryFn: () => courierSettlementApi.balances(params).then((r) => r.data),
  })
}

export function useExceptions(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['cs-exceptions', params],
    queryFn: () => courierSettlementApi.exceptions(params).then((r) => r.data),
  })
}

export function useFinanceRules() {
  return useQuery({
    queryKey: ['cs-finance-rules'],
    queryFn: () => courierSettlementApi.financeRules().then((r) => r.data),
  })
}

export function useInvoice(id: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['cs-invoice', id, params],
    queryFn: () => courierSettlementApi.invoice(id, params).then((r) => r.data),
    enabled: !!id,
    placeholderData: (prev) => prev,
    // §17: poll while the background import runs — stops the moment it lands.
    refetchInterval: (query: any) =>
      query.state?.data?.invoice?.state === 'IMPORTING' ? 2000 : false,
  })
}

/** Preview of a stored (not yet imported) draft — re-reads the original bytes. */
export function usePreview(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cs-preview', id],
    queryFn: () => courierSettlementApi.preview(id as string).then((r) => r.data),
    enabled: enabled && !!id,
    retry: false,
  })
}

/** Cross-invoice reconciliation (rows + exceptions across finalized invoices). */
export function useReconciliation(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['cs-reconciliation', params],
    queryFn: () => courierSettlementApi.reconciliation(params).then((r) => r.data),
  })
}

/** Column alias candidates (saved mappings) for one courier. */
export function useColumnMappings(courier: string | null | undefined) {
  return useQuery({
    queryKey: ['cs-mappings', courier],
    queryFn: () => courierSettlementApi.mappings(courier as string).then((r) => r.data),
    enabled: !!courier,
    retry: false,
  })
}

export function useInvoiceActivity(id: string) {
  return useQuery({
    queryKey: ['cs-activity', id],
    queryFn: () => courierSettlementApi.activity(id).then((r) => r.data),
    enabled: !!id,
  })
}

export function useInvoiceAdjustments(id: string) {
  return useQuery({
    queryKey: ['cs-adjustments', id],
    queryFn: () => courierSettlementApi.adjustments(id).then((r) => r.data),
    enabled: !!id,
  })
}

function invalidate(qc: any, keys: string[][]) {
  for (const k of keys) qc.invalidateQueries({ queryKey: k })
}

const ALL_LIST_KEYS: string[][] = [
  ['cs-invoice'],
  ['cs-invoices'],
  ['cs-overview'],
  ['cs-exceptions'],
  ['cs-activity'],
  ['cs-adjustments'],
  ['cs-balances'],
  ['cs-reconciliation'],
  ['cs-mappings'],
  ['cs-preview'],
]

export function useCourierSettlementMutations() {
  const qc = useQueryClient()

  return {
    upload: useMutation({
      mutationFn: (input: { file: File; courier?: string; revisionOfId?: string }) =>
        courierSettlementApi.upload(input.file, input).then((r) => r.data),
      onSuccess: (res) => {
        // Analyze only — nothing is imported until the preview is confirmed.
        if (res.resumed) {
          toast.info(`Draft ${res.displayId} resumed — nothing was re-imported`)
        } else if (res.duplicateFile) {
          toast.warning(
            `This exact file already exists as an imported invoice — confirm only if you intend a revision`,
            { duration: 8000 },
          )
        } else {
          toast.success(`File analyzed as draft ${res.displayId} — review the preview to import`)
        }
        invalidate(qc, [['cs-invoices'], ['cs-preview'], ['cs-overview']])
      },
      onError: (e) => toast.error(`Analyze failed: ${err(e)}`),
    }),

    /** Preview decision → the ONLY call that commits rows + exceptions. */
    importDraft: useMutation({
      mutationFn: (id: string) => courierSettlementApi.importDraft(id).then((r) => r.data),
      onSuccess: (res) => {
        toast.success(
          `Invoice ${res.displayId} imported: ${res.rowCount} rows (${res.matchedCount} matched)`,
        )
        invalidate(qc, ALL_LIST_KEYS)
      },
      onError: (e) => toast.error(`Import refused: ${err(e)}`),
    }),

    saveMapping: useMutation({
      mutationFn: (body: {
        courier: string
        sourceHeader: string
        field: string
        alwaysUse?: boolean
        reason?: string
        invoiceId?: string
      }) => courierSettlementApi.createMapping(body).then((r) => r.data),
      onSuccess: (res) => {
        toast.success(
          res.active
            ? `Mapping saved and active: "${res.sourceHeader}" → ${res.fieldLabel}`
            : `Mapping saved as a candidate: "${res.sourceHeader}" → ${res.fieldLabel} (confirm "Always use" to activate)`,
        )
        invalidate(qc, [['cs-mappings'], ['cs-preview'], ['cs-activity']])
      },
      onError: (e) => toast.error(`Mapping rejected: ${err(e)}`),
    }),

    activateMapping: useMutation({
      mutationFn: ({ id, reason, invoiceId }: { id: string; reason?: string; invoiceId?: string }) =>
        courierSettlementApi.activateMapping(id, { reason, invoiceId }).then((r) => r.data),
      onSuccess: (res) => {
        toast.success(`Mapping active: "${res.sourceHeader}" → ${res.field}`)
        invalidate(qc, [['cs-mappings'], ['cs-preview'], ['cs-activity']])
      },
      onError: (e) => toast.error(`Activation refused: ${err(e)}`),
    }),

    deactivateMapping: useMutation({
      mutationFn: ({ id, reason, invoiceId }: { id: string; reason?: string; invoiceId?: string }) =>
        courierSettlementApi.deactivateMapping(id, { reason, invoiceId }).then((r) => r.data),
      onSuccess: () => {
        toast.success('Mapping deactivated')
        invalidate(qc, [['cs-mappings'], ['cs-preview']])
      },
      onError: (e) => toast.error(`Deactivate refused: ${err(e)}`),
    }),

    finalize: useMutation({
      mutationFn: ({ id, body }: { id: string; body?: Record<string, unknown> }) =>
        courierSettlementApi.finalize(id, body ?? {}).then((r) => r.data),
      onSuccess: (res) => {
        if (res.warnings?.length) {
          for (const w of res.warnings) toast.warning(w, { duration: 8000 })
        }
        toast.success(
          res.journalEntryId
            ? `Invoice finalized — journal ${res.journalEntryId} posted`
            : 'Invoice finalized',
        )
        invalidate(qc, ALL_LIST_KEYS)
      },
      onError: (e) => toast.error(`Finalize blocked: ${err(e)}`),
    }),

    discard: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
        courierSettlementApi.discard(id, reason).then((r) => r.data),
      onSuccess: (res) => {
        toast.success('Invoice discarded')
        invalidate(qc, ALL_LIST_KEYS)
      },
      onError: (e) => toast.error(`Discard refused: ${err(e)}`),
    }),

    repairAccounting: useMutation({
      mutationFn: (id: string) =>
        courierSettlementApi.repairAccounting(id).then((r) => r.data),
      onSuccess: (res) => {
        if (res.warnings?.length) {
          for (const w of res.warnings) toast.warning(w, { duration: 8000 })
        }
        toast.success(
          res.journalEntryId
            ? `Accounting repaired — journal ${res.journalEntryId}`
            : 'Accounting repaired',
        )
        invalidate(qc, ALL_LIST_KEYS)
      },
      onError: (e) => toast.error(`Repair failed: ${err(e)}`),
    }),

    reclaimStale: useMutation({
      mutationFn: (id: string) => courierSettlementApi.reclaimStale(id).then((r) => r.data),
      onSuccess: (res) => {
        toast.success(res.reclaimed ? 'Stale finalization reclaimed' : 'Nothing to reclaim')
        invalidate(qc, [['cs-invoice'], ['cs-invoices']])
      },
      onError: (e) => toast.error(`Reclaim failed: ${err(e)}`),
    }),

    postAccounting: useMutation({
      mutationFn: (id: string) => courierSettlementApi.postAccounting(id).then((r) => r.data),
      onSuccess: (res) => {
        if (res.warnings?.length) {
          for (const w of res.warnings) toast.warning(w, { duration: 8000 })
        }
        toast.success(
          res.journalEntryId ? `Posted journal ${res.journalEntryId}` : 'Accounting posted',
        )
        invalidate(qc, ALL_LIST_KEYS)
      },
      onError: (e) => toast.error(`Posting failed: ${err(e)}`),
    }),

    acknowledge: useMutation({
      mutationFn: ({ invoiceId, exceptionId }: { invoiceId: string; exceptionId: string }) =>
        courierSettlementApi
          .acknowledgeException(invoiceId, exceptionId)
          .then((r) => r.data),
      onSuccess: () => {
        toast.success('Warning acknowledged')
        invalidate(qc, [['cs-exceptions'], ['cs-invoice'], ['cs-overview']])
      },
      onError: (e) => toast.error(err(e)),
    }),

    createAdjustment: useMutation({
      mutationFn: ({ invoiceId, body }: { invoiceId: string; body: Record<string, unknown> }) =>
        courierSettlementApi.createAdjustment(invoiceId, body).then((r) => r.data),
      onSuccess: () => {
        toast.success('Adjustment applied')
        invalidate(qc, ALL_LIST_KEYS)
      },
      onError: (e) => toast.error(`Adjustment rejected: ${err(e)}`),
    }),

    previewAdjustment: useMutation({
      mutationFn: ({ invoiceId, body }: { invoiceId: string; body: Record<string, unknown> }) =>
        courierSettlementApi.previewAdjustment(invoiceId, body).then((r) => r.data),
      onError: (e) => toast.error(err(e)),
    }),

    reverseAdjustment: useMutation({
      mutationFn: ({ adjustmentId, reason }: { adjustmentId: string; reason: string }) =>
        courierSettlementApi.reverseAdjustment(adjustmentId, reason).then((r) => r.data),
      onSuccess: () => {
        toast.success('Adjustment reversed')
        invalidate(qc, ALL_LIST_KEYS)
      },
      onError: (e) => toast.error(`Reversal failed: ${err(e)}`),
    }),

    manualMatch: useMutation({
      mutationFn: ({
        rowId,
        orderId,
        reason,
      }: {
        rowId: string
        orderId: string
        reason?: string
      }) => courierSettlementApi.manualMatch(rowId, orderId, reason).then((r) => r.data),
      onSuccess: () => {
        toast.success('Row matched')
        invalidate(qc, [['cs-invoice'], ['cs-exceptions'], ['cs-overview']])
      },
      onError: (e) => toast.error(`Match failed: ${err(e)}`),
    }),

    revalidateRow: useMutation({
      mutationFn: (rowId: string) => courierSettlementApi.revalidateRow(rowId),
      onSuccess: () => {
        toast.success('Row re-evaluated')
        invalidate(qc, [['cs-invoice'], ['cs-exceptions']])
      },
      onError: (e) => toast.error(`Revalidate failed: ${err(e)}`),
    }),

    createFinanceRule: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        courierSettlementApi.createFinanceRule(body).then((r) => r.data),
      onSuccess: () => {
        toast.success('Finance rule saved')
        invalidate(qc, [['cs-finance-rules']])
      },
      onError: (e) => toast.error(`Rule rejected: ${err(e)}`),
    }),

    /** §12 arithmetic preview — result is rendered inline, no toast, no cache. */
    testFinanceRule: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        courierSettlementApi.testFinanceRule(body).then((r) => r.data),
      onError: (e) => toast.error(`Rule test failed: ${err(e)}`),
    }),
  }
}
