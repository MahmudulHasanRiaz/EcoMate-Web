import { apiClient } from '@/lib/api-client'

export interface VolumeByEventTypeRow {
  eventType: string
  count: number
}

export interface DispatchFunnel {
  pending: number
  sending: number
  sent: number
  retry: number
  failed: number
  dead: number
  skipped: number
  deduped: number
}

export interface DlqStats {
  deadCount: number
  dlqDepth: number
}

export interface RelayHealth {
  relayEnabled: boolean
  pendingCount: number
  claimedCount: number
  oldestPendingAgeSec: number | null
}

export interface RedisHealth {
  connected: boolean
}

export interface QueueHealth {
  waiting: number
  active: number
  delayed: number
  failed: number
  completed: number
  reachable: boolean
}

export interface DispatcherHealth {
  sending: number
}

export interface HealthResponse {
  relayHealth: RelayHealth
  redisHealth: RedisHealth
  queueHealth: QueueHealth
  dispatcherHealth: DispatcherHealth
}

export interface MirrorCaptureStats {
  totalSnapshots: number
  browserOrigin: number
  serverOrigin: number
  browserMirrorRatio: number
}

export interface OverviewResponse {
  volumeByEventType: VolumeByEventTypeRow[]
  dispatchFunnel: Record<string, DispatchFunnel>
  deadStats: DlqStats
  relayHealth?: RelayHealth
}

export interface RetryHistogramRow {
  attemptCount: number
  count: number
}

export interface TopFailureRow {
  errorMsg: string
  count: number
}

export interface FailuresResponse {
  topFailures: TopFailureRow[]
  retryHistogram: RetryHistogramRow[]
}

export interface FreshnessResponse {
  avgCaptureToDispatchSec: number
  p95CaptureToDispatchSec: number
}

export interface DedupKeyUsageRow {
  key: 'event_id' | 'context_external_id' | 'fbp' | 'fbc'
  events: number
}

export interface DedupResponse {
  keyUsage: DedupKeyUsageRow[]
}

export interface DispatchEventRow {
  id: string
  snapshotId: string
  eventId: string
  orderId: string | null
  ctxId: string | null
  provider: string | null
  queueJobId: string | null
  fromStatus: string | null
  toStatus: string
  attempt: number | null
  message: string | null
  createdAt: string
}

export interface TimelineResponse {
  eventType: string | null
  status: string | null
  events: DispatchEventRow[]
}

export interface EmqProxy {
  windowedDispatches: number
  qualityFlagged: number
  noEmPhShare: number
}

export interface QualityRates {
  windowedDispatches: number
  sent: number
  deduped: number
  failed: number
  dead: number
  retried: number
  dedupedCaptures: number
  capturedSnapshots: number
  replayed: number
  dedupRate: number
  retryRate: number
  emq: EmqProxy
  mirror: MirrorCaptureStats
}

export interface QualityResponse {
  quality: QualityRates
}

export interface IdentityCoverageRow {
  field: string
  base: 'snapshot' | 'context'
  count: number
  total: number
  coverage: number
}

export interface CoverageResponse {
  identityCoverage: IdentityCoverageRow[]
}

export interface WatchdogViolation {
  severity: 'critical' | 'warning' | 'info'
  code: string
  message: string
}

export interface WatchdogResponse {
  violations: WatchdogViolation[]
}

export interface HealthScore {
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  penalties: { code: string; points: number; message: string }[]
}

export interface HealthScoreResponse {
  healthScore: HealthScore
}

export interface PurchaseReconciliation {
  // Business lifecycle
  newOrders: number
  confirmedOrders: number
  deliveredOrders: number
  // Source classification
  confirmedBySource: {
    DIRECT_WEBSITE: number
    POS: number
    INCOMPLETE_CONVERSION: number
    MANUAL: number
  }
  // Configuration waterfall
  eligibleConfirmed: number
  configExcludedConfirmed: number
  configExcludedBreakdown: Array<{
    sourceCategory: string
    configKey: string
    configValue: boolean
    count: number
  }>
  expectedPurchases: number
  // Canonical tracking result
  canonicalPurchases: number
  matchedPurchases: number
  missingEligiblePurchases: number
  unexpectedPurchases: number
  dedupedPurchases: number
  // Trigger mode breakdown
  instantPurchases: number
  validatedPurchases: number
  offlinePurchases: number
  browserPurchases: number
  replayedEvents: number
  // Provider delivery
  providerReconciliation: Array<{
    provider: string
    expected: number
    sent: number
    pending: number
    failed: number
    skipped: number
    missing: number
  }>
  // Drill-down
  missingOrderIds: string[]
  unexpectedOrderIds: string[]
  configExcludedOrderIds: Array<{ orderId: string; source: string; configKey: string }>
  // Metadata
  metaPurchaseMode: string
  metaValidatedStatus: string
  range: { from: string; to: string }
}

export interface PurchaseReconciliationResponse {
  reconciliation: PurchaseReconciliation
}

/** Date range query parameters for monitoring endpoints. */
export interface DateRangeParams {
  from?: string
  to?: string
  preset?: 'today' | 'yesterday' | 'last7days'
}

/** Build query string from date range params. */
function buildRangeQuery(params?: DateRangeParams): string {
  if (!params) return 'preset=today'
  if (params.preset) return `preset=${params.preset}`
  if (params.from && params.to) return `from=${params.from}&to=${params.to}`
  return 'preset=today'
}

export const monitoringApi = {
  overview: (params?: DateRangeParams) =>
    apiClient.get<OverviewResponse>(`/tracking/admin/monitoring/overview?${buildRangeQuery(params)}`).then((r) => r.data),
  failures: (limit = 10) =>
    apiClient.get<FailuresResponse>(`/tracking/admin/monitoring/failures?limit=${limit}`).then((r) => r.data),
  freshness: (params?: DateRangeParams) =>
    apiClient.get<FreshnessResponse>(`/tracking/admin/monitoring/freshness?${buildRangeQuery(params)}`).then((r) => r.data),
  dedup: (params?: DateRangeParams) =>
    apiClient.get<DedupResponse>(`/tracking/admin/monitoring/dedup?${buildRangeQuery(params)}`).then((r) => r.data),
  health: () =>
    apiClient.get<HealthResponse>(`/tracking/admin/monitoring/health`).then((r) => r.data),
  mirrorCapture: (params?: DateRangeParams) =>
    apiClient.get<{ mirrorCapture: MirrorCaptureStats }>(`/tracking/admin/monitoring/mirror-capture?${buildRangeQuery(params)}`).then((r) => r.data),
  emq: (params?: DateRangeParams) =>
    apiClient.get<{ emq: EmqProxy }>(`/tracking/admin/monitoring/emq?${buildRangeQuery(params)}`).then((r) => r.data),
  quality: (params?: DateRangeParams) =>
    apiClient.get<QualityResponse>(`/tracking/admin/monitoring/quality?${buildRangeQuery(params)}`).then((r) => r.data),
  coverage: (params?: DateRangeParams) =>
    apiClient.get<CoverageResponse>(`/tracking/admin/monitoring/coverage?${buildRangeQuery(params)}`).then((r) => r.data),
  watchdog: (params?: DateRangeParams) =>
    apiClient.get<WatchdogResponse>(`/tracking/admin/monitoring/watchdog?${buildRangeQuery(params)}`).then((r) => r.data),
  healthScore: (params?: DateRangeParams) =>
    apiClient.get<HealthScoreResponse>(`/tracking/admin/monitoring/health-score?${buildRangeQuery(params)}`).then((r) => r.data),
  purchaseReconciliation: (params?: DateRangeParams) =>
    apiClient.get<PurchaseReconciliationResponse>(`/tracking/admin/monitoring/purchase-reconciliation?${buildRangeQuery(params)}`).then((r) => r.data),
  timeline: (eventId: string) =>
    apiClient
      .get<TimelineResponse>(`/tracking/admin/monitoring/timeline?eventId=${encodeURIComponent(eventId)}`)
      .then((r) => r.data),
}
