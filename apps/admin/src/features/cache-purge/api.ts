import { apiClient } from '@/lib/api-client'

/**
 * "Purge all cache" API (P0 stale-bundle round, 2026-11-12).
 * Shapes mirror the backend's PurgeAllResult exactly.
 */
export type PurgeLayerStatus =
  | 'purged'
  | 'skipped'
  | 'failed'
  | 'not_configured'

export interface PurgeLayerResult {
  status: PurgeLayerStatus
  detail: string
}

export interface PurgeAllResult {
  purgedAt: string
  version: string
  storefrontUrl: string
  layers: {
    backendCache: PurgeLayerResult
    cloudflare: PurgeLayerResult
    storefront: PurgeLayerResult
    versionBump: PurgeLayerResult
  }
}

export const PURGE_LAYER_LABELS: Record<keyof PurgeAllResult['layers'], string> = {
  backendCache: 'Backend cache',
  cloudflare: 'Cloudflare edge cache',
  storefront: 'Storefront pages',
  versionBump: 'Cache version',
}

export const PURGE_LAYER_ORDER: (keyof PurgeAllResult['layers'])[] = [
  'backendCache',
  'cloudflare',
  'storefront',
  'versionBump',
]

export async function purgeAllCache(): Promise<PurgeAllResult> {
  // A purge fans out to Cloudflare + the storefront, each with its own
  // 10s timeout server-side — the default 15s client timeout is too
  // tight, same reason the reconciliation fix-all passes 120s.
  const res = await apiClient.post<PurgeAllResult>('/cache-purge', {}, { timeout: 120_000 })
  return res.data
}
