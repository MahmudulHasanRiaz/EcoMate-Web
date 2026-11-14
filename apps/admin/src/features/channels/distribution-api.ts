import { apiClient } from '@/lib/api-client'

// ─── Response shapes (central-commerce §10, P3) ──────────────────────────────

export interface StoreAvailabilityRow {
  storeId: string
  kind: string
  name: string
  overrideAvailable: boolean | null
  ruleAvailable: boolean | null
  effective: boolean
}

export interface ProductAvailabilityView {
  productId: string
  globalActive: boolean
  stores: StoreAvailabilityRow[]
}

export interface BulkAvailabilityResult {
  enqueued: boolean
  jobId?: string
  updated: number
  total: number
  excludedNativeCount: number
}

export interface BulkJobStatus {
  jobId: string
  productId: string
  action: 'all_on' | 'all_off'
  status: 'RUNNING' | 'DONE' | 'FAILED'
  total: number
  done: number
  failed: number
  error?: string
}

export interface AvailabilityRuleResponse {
  storeId: string
  categoryId: string
  categoryName: string
  categoryPath: string
  available: boolean
  inheritFromParent: boolean
}

export interface CategoryNode {
  id: string
  name: string
  parentId?: string | null
  children?: CategoryNode[]
}

// ─── Pure helpers (unit-tested in distribution-api.test.ts) ─────────────────

export const DISABLE_ALL_CONFIRM_TEXT = 'DISABLE'

export function isDisableConfirmValid(value: string): boolean {
  return value === DISABLE_ALL_CONFIRM_TEXT
}

/**
 * Which §8.2 layer decides the row: override ?? rule ?? default.
 * NATIVE rows are global-only by construction (BR-20).
 */
export function availabilitySourceLabel(row: StoreAvailabilityRow): string {
  if (row.kind === 'NATIVE') return 'Native (global only)'
  if (row.overrideAvailable !== null && row.overrideAvailable !== undefined) return 'Manual override'
  if (row.ruleAvailable !== null && row.ruleAvailable !== undefined) return 'Category rule'
  return 'Default off'
}

/** Pre-order category flatten with depth (tree selects, rule editors). */
export function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = []
  for (const n of nodes ?? []) {
    out.push({ id: n.id, label: n.name, depth })
    if (n.children?.length) out.push(...flattenCategories(n.children, depth + 1))
  }
  return out
}

// ─── API client ─────────────────────────────────────────────────────────────

export const distributionApi = {
  getAvailability: (productId: string) =>
    apiClient.get<ProductAvailabilityView>(`/products/${productId}/store-availability`).then(r => r.data),
  setAvailability: (productId: string, storeId: string, available: boolean | null) =>
    apiClient.put(`/products/${productId}/store-availability`, { storeId, available }).then(r => r.data),
  bulk: (productId: string, action: 'all_on' | 'all_off', confirm?: string) =>
    apiClient.post<BulkAvailabilityResult>(`/products/${productId}/store-availability/bulk`, { action, confirm }).then(r => r.data),
  bulkJob: (productId: string, jobId: string) =>
    apiClient.get<BulkJobStatus>(`/products/${productId}/store-availability/bulk/${jobId}`).then(r => r.data),
  listRules: (storeId?: string) =>
    apiClient.get<AvailabilityRuleResponse[]>('/store-availability-rules', { params: storeId ? { storeId } : undefined }).then(r => r.data),
  upsertRule: (categoryId: string, payload: { storeId: string; available: boolean; inheritFromParent?: boolean }) =>
    apiClient.put(`/store-availability-rules/${categoryId}`, payload).then(r => r.data),
}
