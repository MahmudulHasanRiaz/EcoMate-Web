import { apiClient } from '@/lib/api-client'

// ── Courier Settlement API (route: /admin/op/courier-settlement) ─────────────
// Types mirror the backend read model exactly — the UI never invents a figure.

const BASE = '/courier-settlement'

/** Mirrors `CourierSettlementInvoiceState` in prisma/schema.prisma. */
export type InvoiceState =
  | 'UPLOADED'
  | 'ANALYZED'
  | 'MAPPING_REQUIRED'
  | 'IMPORTING'
  | 'READY_FOR_REVIEW'
  | 'REVIEW_REQUIRED'
  | 'ISSUE_FOUND'
  | 'FINALIZING'
  | 'FINALIZED_PENDING_ACCOUNTING'
  | 'ACCOUNTING_POSTED'
  | 'ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED'
  | 'ACCOUNTING_FAILED'
  | 'ADJUSTED'
  | 'RECONCILED'
  | 'DISCARDED'

export type ExceptionSeverity = 'red' | 'yellow'
export type ExceptionStatus = 'open' | 'acknowledged' | 'resolved' | 'waived'

export interface Money {
  value: number | null
  state: 'actual' | 'estimated' | 'unavailable' | 'not_applicable'
  reason?: string
}

export interface PageMeta {
  page: number
  limit: number
  total: number
  pages: number
}

export interface InvoiceSummary {
  id: string
  displayId: string
  courier: string
  provider: string | null
  invoiceNo: string | null
  invoiceDate: string
  rowCount: number
  state: InvoiceState
  accountingStatus?: string | null
  isRevision?: boolean
  revisionOfId?: string | null
  createdAt: string
  finalizedAt?: string | null
  effectiveTotals?: InvoiceTotals | null
  openExceptions?: number
}

export interface InvoiceTotals {
  collected: number
  charges: number
  net: number
  residual: number
  cashReceived: number
  cashDisbursed: number
}

export interface InvoiceRow {
  id: string
  invoiceId: string
  rowNumber: number
  rowClass: string
  rowKind: string
  consignmentId: string | null
  orderId: string | null
  dispatchId: string | null
  identifier: string | null
  declaredCollected: number
  declaredCharges: number
  declaredNet: number
  declaredResidual: number
  effectiveCollected: number
  effectiveCharges: number
  effectiveNet: number
  effectiveResidual: number
  matchMethod: string
  matchContext: Record<string, unknown> | null
  normalized: Record<string, unknown> | null
  rawJson: Record<string, unknown> | null
  hasAdjustment: boolean
  reviewState: 'green' | 'yellow' | 'red'
  supersededByRowId?: string | null
  exceptions?: ExceptionItem[]
  adjustments?: AdjustmentItem[]
  order?: { id: string; displayId: string } | null
}

export interface ExceptionItem {
  id: string
  invoiceId: string
  rowId: string | null
  orderId: string | null
  ruleId: string
  severity: ExceptionSeverity
  status: ExceptionStatus
  blocked: boolean
  message: string | null
  createdAt: string
  context?: Record<string, unknown> | null
  resolvedAt?: string | null
  resolvedBy?: string | null
  /** cross-invoice queue enrichment (workspace Exceptions tab) */
  invoice?: { displayId: string; courier: string; state: InvoiceState; provider: string | null }
  row?: { rowNumber: number; identifier: string | null; matchMethod: string } | null
}

export interface AdjustmentItem {
  id: string
  invoiceId: string
  rowId: string | null
  adjustmentClass: 'source' | 'cost' | 'settlement'
  field: string
  originalValue: string | null
  adjustedValue: string | null
  difference: number | null
  reason: string | null
  counterpart: string | null
  userId: string | null
  journalEntryId: string | null
  reversalOfId: string | null
  reversedById: string | null
  createdAt: string
}

export interface ActivityItem {
  id: string
  invoiceId: string
  action: string
  actor: string | null
  detail: Record<string, unknown> | null
  dedupeKey?: string | null
  timestamp: string
}

export interface OverviewResponse {
  range: { from: string; to: string }
  kpis: {
    settledThisPeriod: { net: number; cashReceived: number; cashDisbursed: number }
    courierCost: number
    shippingMargin: number
    codOutstanding: number
    awaitingSettlement: number
    exceptions: { red: number; yellow: number; open: number }
  }
  waterfall: {
    expected: number
    collected: number
    charges: number
    net: number
    cashReceived: number
    cashDisbursed: number
  }
  invoicesByState: Record<string, number>
  invariant: { currentEffectiveCharges: number; periodCharges: number; equal: boolean }
}

export interface BalancesResponse {
  kpis: { outstandingCod: number; payableToCourier: number; awaitingSettlement: number }
  buckets: { notYetCollected: number; collectedNotRemitted: number }
  orders: {
    orderId: string
    displayId: string
    expectedCod: number
    collected: number
    charges: number
    net: number
    codPosition: number
    outstandingCod: number
    payableToCourier: number
    settlementRows: number
  }[]
}

export interface HistoricalResponse {
  version: number
  takenAt: string
  takenById: string | null
  journalEntryId: string | null
  reason: string | null
  totals: InvoiceTotals
  rows: unknown[]
  snapshots: { version: number; takenAt: string; reason: string | null }[]
}

export interface EffectiveResponse {
  state: InvoiceState
  accountingStatus: string | null
  effectiveTotals: InvoiceTotals
  currentRows: number
  supersededRows: number
}

export interface FinanceRuleVersion {
  version: number
  snapshot: {
    courier?: string
    format?: string | null
    netRule?: string
    chargeComponents?: unknown
    residualThreshold?: number
    tolerance?: number
    identifierOrder?: unknown
    note?: string | null
  }
  approvedById?: string | null
  approvedAt?: string | null
  createdAt?: string
}

export interface FinanceRuleResponse {
  id: string
  courier: string
  format: string | null
  netRule: string
  tolerance: number
  residualThreshold?: number
  chargeComponents?: unknown
  identifierOrder?: unknown
  version?: number
  note?: string | null
  approvedById?: string | null
  approvedAt?: string | null
  versions?: FinanceRuleVersion[]
}

/** `POST /finance-rules/test` — pure arithmetic preview of a candidate rule. */
export interface FinanceRuleTestResponse {
  ok: boolean
  proven: boolean
  charges: number
  net: number | null
  residual: number | null
  severity: 'ok' | 'yellow' | 'red' | null
  explanation: string
}

/** Mirrors `UploadResult` in courier-settlement-import.service.ts exactly. */
export interface UploadResult {
  invoiceId: string
  displayId: string
  provider: string
  state: InvoiceState
  rowCount: number
  matchedCount: number
  severity: 'green' | 'yellow' | 'red'
  blocking: boolean
  duplicateFile: boolean
  resumed?: boolean
  preview?: InvoicePreview
}

// ── Import preview (Upload → Analyze → Preview → Decision) ──────────────────

export interface PreviewFinding {
  severity: 'red' | 'yellow' | 'green'
  ruleId: string
  message: string
  count: number
  blocking: boolean
  sampleRowNumbers: number[]
}

export interface PreviewRowFinding {
  ruleId: string
  severity: 'red' | 'yellow'
  blocking: boolean
  message: string
}

export interface PreviewRow {
  rowNumber: number
  rowClass: string
  rowKind: string
  identifier: string | null
  matchMethod: string
  reviewState: 'green' | 'yellow' | 'red'
  declared: { collected: number; charges: number; net: number; residual: number }
  findings: PreviewRowFinding[]
  raw: Record<string, string>
}

export interface PreviousSettlement {
  orderId: string
  orderDisplayId: string | null
  invoices: { invoiceId: string; displayId: string; finalizedAt: string | null }[]
  net: number
  charges: number
  collected: number
  rowCount: number
}

export interface InvoicePreview {
  invoiceId: string
  displayId: string
  state: InvoiceState
  resumed: boolean
  duplicateFile: boolean
  identity: {
    courier: string
    provider: string
    invoiceNo: string | null
    invoiceDate: string
    filename: string
    fileSize: number
    fileMime: string | null
    sha256: string
    format: string
    detectReason?: string
    proven: boolean
    structureOnly: boolean
  }
  classification: {
    total: number
    data: number
    summary: number
    footer: number
    unknown: number
    blankLines: number
    headers: string[]
  }
  matching: {
    matched: number
    unmatched: number
    duplicateIdentifiersInFile: number
    previouslySettledOrders: number
  }
  money: {
    grossCollected: number
    charges: number
    net: number
    cashReceived: number
    cashDisbursed: number
    residual: number
    expectedCod: number | null
  }
  previousSettlements: PreviousSettlement[]
  findings: PreviewFinding[]
  rows: PreviewRow[]
  rowsTruncated: boolean
}

export interface ReconciliationItem {
  invoiceId: string
  displayId: string
  courier: string
  provider: string | null
  state: InvoiceState
  rows: number
  matched: number
  red: number
  yellow: number
  acknowledged: number
  needsAttention: number
  createdAt: string
  finalizedAt: string | null
}

export interface MappingItem {
  id: string
  courier: string
  sourceHeader: string
  normalizedHeader: string
  field: string
  confidence: number
  origin: string
  active: boolean
  ambiguityCount: number
  createdBy: string | null
  fieldLabel: string
  conflict: boolean
  updatedAt: string
}

/** `GET /invoices/:id` — invoice carries paged rows + paged exceptions. */
export interface InvoiceDetail extends InvoiceSummary {
  rows: InvoiceRow[]
  exceptions: ExceptionItem[]
  updatedAt?: string
  /** Background-import progress (§17): 0–100 + stage while state === IMPORTING. */
  importProgress?: number
  importStage?: string | null
  /**
   * Original file header order (§3/§18). jsonb re-sorts rawJson keys
   * (length-then-byte), so the imported sheet takes its column order from
   * this array; absent on pre-feature invoices (falls back to rawJson union).
   */
  sourceHeaders?: string[] | null
}

export interface InvoiceDetailResponse {
  invoice: InvoiceDetail
  rowsMeta?: { page: number; limit: number; total: number; pages: number }
  exceptionsMeta?: { limit: number; total: number }
  historical: HistoricalResponse | null
  effective: EffectiveResponse
  divergence: {
    version: number
    takenAt: string
    fields: Record<string, { from: number; to: number }>
  } | null
}

/** Mirrors `FinalizeResult` in courier-settlement-finalize.service.ts. */
export interface FinalizeResult {
  invoiceId: string
  state: string
  accountingStatus: string
  journalEntryId: string | null
  totals: InvoiceTotals
  warnings: string[]
  costWrites: number
}

/** `buildCorrectionEntry` + rule findings (the adjustment preview). */
export interface CorrectionPreview {
  deltaG: number
  deltaC: number
  deltaN: number
  deltaR: number
  rejected: boolean
  rejectionReason?: string
  findings: { ruleId: string; severity: ExceptionSeverity; message?: string }[]
}

export interface CostProjectionResponse {
  orderId: string
  shippingCost: number | null
  shippingCostSource: string | null
  state: string
  reason?: string
}

export const courierSettlementApi = {
  overview: (params?: Record<string, unknown>) =>
    apiClient.get<OverviewResponse>(`${BASE}/overview`, { params }),

  invoices: (params?: Record<string, unknown>) =>
    apiClient.get<{ data: InvoiceSummary[]; meta: PageMeta }>(`${BASE}/invoices`, { params }),

  balances: (params?: Record<string, unknown>) =>
    apiClient.get<BalancesResponse>(`${BASE}/balances`, { params }),

  exceptions: (params?: Record<string, unknown>) =>
    apiClient.get<ExceptionItem[]>(`${BASE}/exceptions`, { params }),

  financeRules: () => apiClient.get<FinanceRuleResponse[]>(`${BASE}/finance-rules`),

  createFinanceRule: (body: Record<string, unknown>) =>
    apiClient.post<FinanceRuleResponse>(`${BASE}/finance-rules`, body),

  testFinanceRule: (body: Record<string, unknown>) =>
    apiClient.post<FinanceRuleTestResponse>(`${BASE}/finance-rules/test`, body),

  invoice: (id: string, params?: Record<string, unknown>) =>
    apiClient.get<InvoiceDetailResponse>(`${BASE}/invoices/${id}`, { params }),

  /** Re-open a stored draft's preview without re-uploading the file. */
  preview: (id: string) => apiClient.get<InvoicePreview>(`${BASE}/invoices/${id}/preview`),

  /** The single confirmation point: draft → rows + exceptions. */
  importDraft: (id: string) =>
    apiClient.post<UploadResult>(`${BASE}/invoices/${id}/import`, {}, { timeout: 120000 }),

  reconciliation: (params?: Record<string, unknown>) =>
    apiClient.get<{ data: ReconciliationItem[]; meta: PageMeta }>(`${BASE}/reconciliation`, {
      params,
    }),

  mappings: (courier?: string) =>
    apiClient.get<{ data: MappingItem[]; fields: { field: string; label: string }[]; total: number }>(
      `${BASE}/mappings`,
      { params: courier ? { courier } : undefined },
    ),

  createMapping: (body: {
    courier: string
    sourceHeader: string
    field: string
    alwaysUse?: boolean
    reason?: string
    invoiceId?: string
  }) => apiClient.post<MappingItem>(`${BASE}/mappings`, body),

  activateMapping: (id: string, body: { reason?: string; invoiceId?: string }) =>
    apiClient.post<MappingItem>(`${BASE}/mappings/${id}/activate`, body),

  deactivateMapping: (id: string, body: { reason?: string; invoiceId?: string }) =>
    apiClient.post<MappingItem>(`${BASE}/mappings/${id}/deactivate`, body),

  historical: (id: string) =>
    apiClient.get<HistoricalResponse>(`${BASE}/invoices/${id}/historical`),

  effective: (id: string) =>
    apiClient.get<EffectiveResponse>(`${BASE}/invoices/${id}/effective`),

  activity: (id: string) =>
    apiClient.get<ActivityItem[]>(`${BASE}/invoices/${id}/activity`),

  adjustments: (id: string) =>
    apiClient.get<AdjustmentItem[]>(`${BASE}/invoices/${id}/adjustments`),

  row: (rowId: string) =>
    apiClient.get<InvoiceRow>(`${BASE}/rows/${rowId}`),

  upload: (file: File, extra: { courier?: string; revisionOfId?: string } = {}) => {
    const form = new FormData()
    form.append('file', file)
    if (extra.courier) form.append('courier', extra.courier)
    if (extra.revisionOfId) form.append('revisionOfId', extra.revisionOfId)
    return apiClient.post<UploadResult>(`${BASE}/invoices/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },

  finalize: (id: string, body: Record<string, unknown> = {}) =>
    apiClient.post<FinalizeResult>(`${BASE}/invoices/${id}/finalize`, body, { timeout: 120000 }),

  discard: (id: string, reason?: string) =>
    apiClient.post<{ invoiceId: string; deleted: boolean }>(
      `${BASE}/invoices/${id}/discard`,
      { reason },
    ),

  repairAccounting: (id: string) =>
    apiClient.post<FinalizeResult>(`${BASE}/invoices/${id}/repair-accounting`),

  reclaimStale: (id: string) =>
    apiClient.post<{ reclaimed: boolean }>(`${BASE}/invoices/${id}/reclaim-stale`),

  postAccounting: (id: string) =>
    apiClient.post<FinalizeResult>(`${BASE}/invoices/${id}/post-accounting`),

  acknowledgeException: (invoiceId: string, exceptionId: string) =>
    apiClient.post<ExceptionItem>(`${BASE}/exceptions/${exceptionId}/acknowledge`, null, {
      params: { invoiceId },
    }),

  createAdjustment: (invoiceId: string, body: Record<string, unknown>) =>
    apiClient.post<AdjustmentItem>(`${BASE}/invoices/${invoiceId}/adjustments`, body),

  previewAdjustment: (invoiceId: string, body: Record<string, unknown>) =>
    apiClient.post<CorrectionPreview>(`${BASE}/invoices/${invoiceId}/adjustments/preview`, body),

  reverseAdjustment: (adjustmentId: string, reason: string) =>
    apiClient.post<AdjustmentItem>(`${BASE}/adjustments/${adjustmentId}/reverse`, { reason }),

  manualMatch: (rowId: string, orderId: string, reason?: string) =>
    apiClient.post<InvoiceRow>(`${BASE}/rows/${rowId}/match`, { orderId, reason }),

  revalidateRow: (rowId: string) =>
    apiClient.post<{ ruleId: string; severity: ExceptionSeverity }[]>(
      `${BASE}/rows/${rowId}/revalidate`,
    ),

  /** Immutable original bytes (§9 ①) — served inline for the source viewer. */
  sourceFileUrl: (invoiceId: string) => `/api/courier-settlement/invoices/${invoiceId}/source`,

  costProjection: (orderId: string) =>
    apiClient.get<CostProjectionResponse>(`${BASE}/orders/${orderId}/cost-projection`),
}
