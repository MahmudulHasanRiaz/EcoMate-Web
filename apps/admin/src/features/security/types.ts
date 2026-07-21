export interface DashboardSummary {
  totalEvents1h: number
  totalEvents24h: number
  activeBlocks: number
  autoBlocks24h: number
  criticalEvents24h: number
  topEventType: { eventType: string; count: number } | null
  redisStatus: string
}

export interface SecurityEventItem {
  id: string
  eventType: string
  severity: string
  category: string
  source: string
  timestamp: string
  actorType: string
  ipAddress: string | null
  userId: string | null
  description: string | null
  riskScore: number | null
  correlationId: string | null
}

export interface EventTimelineResponse {
  items: SecurityEventItem[]
  total: number
  page: number
  pageSize: number
}

export interface TrendDataPoint {
  bucket: string
  count: number
  severity: string
  eventType: string
}

export interface TrendResponse {
  data: TrendDataPoint[]
  interval: string
}

export interface TopOffender {
  actorType: string
  actorId: string
  count: number
  lastSeen: string
}

export interface TopOffendersResponse {
  items: TopOffender[]
  window: string
}

export interface BlockActivityPoint {
  date: string
  autoBlocks: number
  manualBlocks: number
  ipBlocks: number
  phoneBlocks: number
}

export interface BlockActivityResponse {
  data: BlockActivityPoint[]
  interval: string
}

export interface RetentionPolicyItem {
  id: string
  category: string
  severity: string
  retentionDays: number
  criticalRetentionDays: number | null
}

export interface RetentionConfigResponse {
  policies: RetentionPolicyItem[]
}

export interface EventDetailResponse {
  id: string
  eventType: string
  severity: string
  category: string
  source: string
  timestamp: string
  actorType: string
  ipAddress: string | null
  userId: string | null
  sessionId: string | null
  browserTrustId: string | null
  phone: string | null
  trustTier: string | null
  description: string | null
  riskScore: number | null
  metadata: Record<string, unknown> | null
  metadataVersion: number
  correlationId: string | null
  parentCorrelationId: string | null
  retentionOverride: boolean
  createdAt: string
}

export interface CorrelationNode {
  id: string
  eventType: string
  severity: string
  timestamp: string
  description: string | null
  depth: number
}
