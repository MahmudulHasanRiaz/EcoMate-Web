import { apiClient } from '@/lib/api-client'

// ─── Sync Center shapes (§10 sync operations) ─────────────────────────────

export type SyncRunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'CANCELLED'
export type SyncScope = 'PRODUCT' | 'STOCK' | 'ORDER_INGEST' | 'ORDER_PUSH' | 'RECONCILE' | 'MAINTENANCE' | 'PUBLISH'
export type SyncItemStatus = 'PENDING' | 'SUCCESS' | 'SKIPPED' | 'FAILED' | 'DEAD'
export type SyncIssueStatus = 'OPEN' | 'RESOLVED' | 'IGNORED'
export type FieldOwnership = 'ECOMATE' | 'EXTERNAL' | 'CONFLICT'

export interface SyncRunResponse {
  id: string
  scope: SyncScope
  status: SyncRunStatus
  triggerType: string
  storeId?: string | null
  provider?: string | null
  windowDays?: number | null
  wideningReason?: string | null
  /** Additive P11 alias: { days, reason } alongside windowDays/wideningReason. */
  widenedWindow?: { days: number | null; reason?: string | null } | null
  correlationId?: string | null
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  totalCount: number
  startedAt: string
  finishedAt?: string | null
}

export interface SyncRunItemResponse {
  id: string
  runId: string
  storeId?: string | null
  productId?: string | null
  objectType: string
  externalObjectId?: string | null
  status: SyncItemStatus
  reason?: string | null
  field?: string | null
  auditLevel?: string | null
}

export interface SyncIssueResponse {
  id: string
  storeId: string
  code: string
  objectType: string
  objectKey: string
  productId?: string | null
  field?: string | null
  message: string
  status: SyncIssueStatus
  occurrences: number
  firstSeenAt: string
  lastSeenAt: string
  resolveNote?: string | null
}

export interface SyncAttemptResponse {
  id: string
  runId?: string | null
  storeId?: string | null
  objectType: string
  objectKey: string
  productId?: string | null
  field?: string | null
  attemptNo: number
  status: SyncItemStatus
  errorCategory?: string | null
  errorMessage?: string | null
  nextRetryAt?: string | null
  createdAt: string
}

export interface StoreHealthGridRow {
  storeId: string
  name: string
  kind: string
  provider: string
  status: string
  healthState: string
  lastSyncAt?: string | null
  lastHealthCheckAt?: string | null
  lastError?: string | null
  latestCheck?: Record<string, unknown> | null
  openIssues: number
  activeRuns: number
}

export interface RetentionStatusResponse {
  policy: {
    syncRunsDays: number
    syncRunItemsDays: number
    syncAttemptsDays: number
    resolvedIgnoredIssuesDays: number
    openIssues: string
    webhookDeliveriesDays: number
    healthChecksDays: number
  }
  lastPurgeRun?: SyncRunResponse | null
}

export interface OverrideAuditItem {
  id: string
  runId: string
  storeId?: string | null
  productId?: string | null
  objectType: string
  status: SyncItemStatus
  reason?: string | null
  field?: string | null
  createdAt: string
}

export interface FieldStateResponse {
  id: string
  storeId: string
  productId: string
  field: string
  ownership: FieldOwnership
  baselineHash?: string | null
  externalHash?: string | null
  evidence?: 'PLUGIN' | 'INFERRED' | null
  lastPushedAt?: string | null
  updatedAt: string
}

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────

export function runStatusTone(status: SyncRunStatus): 'success' | 'warning' | 'destructive' | 'muted' | 'info' {
  switch (status) {
    case 'SUCCESS': return 'success'
    case 'PARTIAL': return 'warning'
    case 'FAILED': return 'destructive'
    case 'RUNNING': return 'info'
    case 'CANCELLED':
    default: return 'muted'
  }
}

/** Polling: 5s while a run is RUNNING, 30s otherwise (§11). */
export function syncPollInterval(runs: SyncRunResponse[] | undefined): number {
  return (runs ?? []).some((r) => r.status === 'RUNNING') ? 5000 : 30000
}

/** Business-first failure sentence with a primary action (§11 UX contract). */
export function failureSummary(run: SyncRunResponse, storeName?: string): { sentence: string; action: string } {
  const store = storeName ?? 'A store'
  if (run.status === 'PARTIAL') {
    return { sentence: `${store} product sync partially failed (${run.failedCount} of ${run.totalCount} items).`, action: 'Review failed items' }
  }
  return { sentence: `${store} product sync failed before any item succeeded.`, action: 'Reconnect Store' }
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—'
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash
}

/** P11: mirrors backend `isAttemptEligible` — gates Retry buttons in the UI. */
export function isAttemptEligibleUi(
  attempt: { status: SyncItemStatus; nextRetryAt?: string | null },
  now: Date = new Date(),
): boolean {
  if (attempt.status !== 'PENDING' && attempt.status !== 'FAILED') return false
  if (!attempt.nextRetryAt) return true
  return new Date(attempt.nextRetryAt).getTime() <= now.getTime()
}

// ─── API client ───────────────────────────────────────────────────────────

export const syncApi = {
  triggerStoreSync: (storeId: string, scope = 'PRODUCT') =>
    apiClient.post<{ runId: string }>(`/stores/${storeId}/sync`, { scope }).then((r) => r.data),
  syncAll: (scope = 'PRODUCT') =>
    apiClient.post<{ batchRunId: string; childRunIds: string[]; excludedNativeCount: number }>('/stores/sync-all', { scope }).then((r) => r.data),
  publish: () => apiClient.post<{ runId: string }>('/sync/publish', {}).then((r) => r.data),
  runs: (params?: Record<string, string>) => apiClient.get<SyncRunResponse[]>('/sync/runs', { params }).then((r) => r.data),
  runDetail: (id: string) => apiClient.get<SyncRunResponse & { items: SyncRunItemResponse[] }>(`/sync/runs/${id}`).then((r) => r.data),
  runItems: (id: string, params?: Record<string, string>) =>
    apiClient.get<SyncRunItemResponse[]>(`/sync/runs/${id}/items`, { params }).then((r) => r.data),
  cancelRun: (id: string) => apiClient.post(`/sync/runs/${id}/cancel`, {}).then((r) => r.data),
  attempts: (params?: Record<string, string>) => apiClient.get('/sync/attempts', { params }).then((r) => r.data),
  retryAttempt: (id: string) => apiClient.post(`/sync/attempts/${id}/retry`, {}).then((r) => r.data),
  retryAttempts: (attemptIds: string[]) => apiClient.post('/sync/attempts/retry', { attemptIds }).then((r) => r.data),
  retryAllAttempts: (storeId?: string) => apiClient.post('/sync/attempts/retry-all', storeId ? { storeId } : {}).then((r) => r.data),
  ignoreAttempt: (id: string, note?: string) => apiClient.post(`/sync/attempts/${id}/ignore`, { note }).then((r) => r.data),
  healthGrid: (kind?: string) =>
    apiClient.get<StoreHealthGridRow[]>('/sync/health', { params: kind ? { kind } : {} }).then((r) => r.data),
  overridesHistory: (storeId?: string) =>
    apiClient.get<OverrideAuditItem[]>('/sync/overrides/history', { params: storeId ? { storeId } : {} }).then((r) => r.data),
  retentionStatus: () => apiClient.get<RetentionStatusResponse>('/sync/retention/status').then((r) => r.data),
  triggerRetentionPurge: () => apiClient.post('/sync/retention/purge', {}).then((r) => r.data),
  issues: (params?: Record<string, string>) => apiClient.get<SyncIssueResponse[]>('/sync/issues', { params }).then((r) => r.data),
  resolveIssue: (id: string, note?: string) => apiClient.post(`/sync/issues/${id}/resolve`, { note }).then((r) => r.data),
  ignoreIssue: (id: string, note?: string) => apiClient.post(`/sync/issues/${id}/ignore`, { note }).then((r) => r.data),
  productHistory: (storeId: string, productId: string) =>
    apiClient.get(`/sync/product-history`, { params: { storeId, productId } }).then((r) => r.data),
  overrides: (storeId?: string) =>
    apiClient.get<FieldStateResponse[]>('/sync/overrides', { params: storeId ? { storeId } : {} }).then((r) => r.data),
  retryOverrides: (overrideIds: string[]) => apiClient.post('/sync/overrides/retry', { overrideIds }).then((r) => r.data),
  forceEcoMate: (storeId: string, productId: string, fields: string[]) =>
    apiClient.post(`/stores/${storeId}/products/${productId}/overrides/reset`, { fields }).then((r) => r.data),
  keepExternal: (storeId: string, productId: string, fields: string[]) =>
    apiClient.post(`/stores/${storeId}/products/${productId}/overrides/keep`, { fields }).then((r) => r.data),
  resetAll: (storeId: string, productId: string) =>
    apiClient.post(`/stores/${storeId}/products/${productId}/overrides/reset-all`, {}).then((r) => r.data),
}
