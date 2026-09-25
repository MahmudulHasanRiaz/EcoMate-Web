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
  windowDays?: number | null
  wideningReason?: string | null
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
