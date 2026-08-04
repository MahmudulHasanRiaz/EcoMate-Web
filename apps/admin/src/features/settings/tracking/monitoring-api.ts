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

export const monitoringApi = {
  overview: (hours = 24) =>
    apiClient.get<OverviewResponse>(`/tracking/admin/monitoring/overview?hours=${hours}`).then((r) => r.data),
  failures: (limit = 10) =>
    apiClient.get<FailuresResponse>(`/tracking/admin/monitoring/failures?limit=${limit}`).then((r) => r.data),
  freshness: (hours = 24) =>
    apiClient.get<FreshnessResponse>(`/tracking/admin/monitoring/freshness?hours=${hours}`).then((r) => r.data),
  dedup: (hours = 24) =>
    apiClient.get<DedupResponse>(`/tracking/admin/monitoring/dedup?hours=${hours}`).then((r) => r.data),
  health: () =>
    apiClient.get<HealthResponse>(`/tracking/admin/monitoring/health`).then((r) => r.data),
  mirrorCapture: (hours = 24) =>
    apiClient.get<{ mirrorCapture: MirrorCaptureStats }>(`/tracking/admin/monitoring/mirror-capture?hours=${hours}`).then((r) => r.data),
  timeline: (eventId: string) =>
    apiClient
      .get<TimelineResponse>(`/tracking/admin/monitoring/timeline?eventId=${encodeURIComponent(eventId)}`)
      .then((r) => r.data),
}
