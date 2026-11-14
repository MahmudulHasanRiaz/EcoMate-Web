import { apiClient } from '@/lib/api-client'

// ─── Response shapes (secrets are never returned by any read) ───────────────

export type StoreKind = 'NATIVE' | 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM'
export type StoreStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'AUTH_FAILED' | 'ATTENTION_REQUIRED'
export type StoreHealthState = 'HEALTHY' | 'ATTENTION_REQUIRED' | 'ERROR' | 'DISCONNECTED'

export interface StoreResponse {
  id: string
  kind: StoreKind
  name: string
  domainNormalised?: string | null
  providerStoreId?: string | null
  status: StoreStatus
  healthState: StoreHealthState
  autoSyncEnabled: boolean
  settings?: Record<string, unknown> | null
  pluginVersion?: string | null
  capabilities?: ProviderCapabilities | null
  lastSyncAt?: string | null
  lastHealthCheckAt?: string | null
  lastError?: string | null
  createdAt: string
  updatedAt: string
  _count?: { credentials: number; healthChecks: number }
}

export interface ProviderCapabilities {
  products: boolean
  variations: boolean
  categories: boolean
  media: boolean
  delete: boolean
  seo: boolean
  costPrice: boolean
  weight: boolean
  dimensions: boolean
  slug: boolean
  orders: boolean
  webhooks: boolean
  orderStatusUpdate: boolean
  orderStatusUpdateTargets: string[]
  stockStatusFidelity: 'faithful' | 'unsupported'
  contactCheckExposure: boolean
  categoryModel: string
  seoModel: string
  mediaModel: string
  combos: boolean
  externalEditsDetectable: 'plugin' | 'inferred'
}

export interface TestConnectionResponse {
  reachable: boolean
  authenticated: boolean
  permissionsOk: boolean
  mediaReachable?: boolean
  providerStoreId?: string
  existingStoreConflict?: { storeId: string; storeName: string }
  plugin?: { installed: boolean; version?: string }
  capabilities: ProviderCapabilities
}

export interface StoreHealthCheckResponse {
  id: string
  storeId: string
  state: StoreHealthState
  reason?: string | null
  reachable: boolean
  authenticated: boolean
  permissionsOk: boolean
  mediaReachable?: boolean | null
  checkedAt: string
}

export interface CreateStorePayload {
  kind: 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM'
  name: string
  domain?: string
  providerStoreId?: string
  credentials?: Record<string, unknown>
}

// ─── P9 wizard "Sync configuration" (§11 canonical steps) ──────────────────

export type InitialSyncPolicy = 'adopt_existing'

/** Fixed first-contact policy (BR-05, not editable in the wizard). */
export const INITIAL_SYNC_POLICY: InitialSyncPolicy = 'adopt_existing'

export interface SyncScope {
  products: boolean
  orders: boolean
  stock: boolean
}

/** Wizard defaults: every scope on. */
export const DEFAULT_SYNC_SCOPE: SyncScope = { products: true, orders: true, stock: true }

export interface UpdateStorePayload {
  name?: string
  settings?: Record<string, unknown>
  autoSyncEnabled?: boolean
  /** P9 additive: persisted into `settings.syncScope` server-side. */
  syncScope?: Partial<SyncScope>
  /** P9 additive: persisted into `settings.initialSyncPolicy` server-side. */
  initialSyncPolicy?: InitialSyncPolicy
}

// ─── Pure helpers (unit-tested in api.test.ts) ──────────────────────────────

export function healthTone(state: StoreHealthState): 'success' | 'warning' | 'destructive' | 'muted' {
  switch (state) {
    case 'HEALTHY': return 'success'
    case 'ATTENTION_REQUIRED': return 'warning'
    case 'ERROR': return 'destructive'
    case 'DISCONNECTED':
    default: return 'muted'
  }
}

/**
 * Informational capability rows (never failures — §11 UX contract).
 * Shopify stock, WooCommerce SEO without the plugin, combos and
 * unsupported categories state the consequence, never a failure.
 */
export function capabilityNotices(caps: ProviderCapabilities | null | undefined): string[] {
  if (!caps) return []
  const rows: string[] = []
  if (caps.stockStatusFidelity === 'unsupported') {
    rows.push('Stock status is monitor-only on this provider: EcoMate never writes stock here (BR-08); drift is reported for operator review.')
  }
  if (!caps.seo) {
    rows.push('SEO fields need the companion plugin on this provider; products sync without them until it is installed.')
  }
  if (!caps.combos) {
    rows.push('Combos are skipped with an explicit reason on this provider — a combo is never fabricated as a simple product (BR-22).')
  }
  if (caps.categoryModel === 'unsupported') {
    rows.push('Categories are unsupported on this provider: the EcoMate hierarchy stays local and product sync proceeds.')
  }
  if (!caps.costPrice) {
    rows.push('Cost price has no native field on this provider and is never pushed (BR-23).')
  }
  if (!caps.dimensions) {
    rows.push('Dimensions are not native to this provider and are skipped with a reason.')
  }
  if (caps.externalEditsDetectable === 'inferred') {
    rows.push('Store-side edits are detected by comparison; the companion plugin upgrades this to authoritative provenance.')
  }
  return rows
}

// ─── API client ─────────────────────────────────────────────────────────────

export const storesApi = {
  list: () => apiClient.get<StoreResponse[]>('/stores').then(r => r.data),
  detail: (id: string) => apiClient.get<StoreResponse>(`/stores/${id}`).then(r => r.data),
  create: (payload: CreateStorePayload) => apiClient.post<StoreResponse>('/stores', payload).then(r => r.data),
  update: (id: string, payload: UpdateStorePayload) =>
    apiClient.patch<StoreResponse>(`/stores/${id}`, payload).then(r => r.data),
  disconnect: (id: string) => apiClient.delete<StoreResponse>(`/stores/${id}`).then(r => r.data),
  rotateCredentials: (id: string, credentials: Record<string, unknown>) =>
    apiClient.post(`/stores/${id}/credentials`, { credentials }).then(r => r.data),
  testConnection: (id: string, credentials?: Record<string, unknown>) =>
    apiClient.post<TestConnectionResponse>(`/stores/${id}/test-connection`, { credentials }).then(r => r.data),
  reconnect: (id: string, credentials: Record<string, unknown>) =>
    apiClient.post<StoreResponse>(`/stores/${id}/reconnect`, { credentials }).then(r => r.data),
  health: (id: string) => apiClient.get<StoreHealthCheckResponse | null>(`/stores/${id}/health`).then(r => r.data),
}
