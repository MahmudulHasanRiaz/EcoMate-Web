import { SecurityEventSeverity, SecurityEventCategory, SecurityActorType } from '@prisma/client';

// ─── Dashboard Summary ───────────────────────────────────────────

export interface DashboardSummary {
  totalEvents24h: number;
  totalEvents1h: number;
  activeBlocks: number;
  autoBlocks24h: number;
  criticalEvents24h: number;
  topEventType: { eventType: string; count: number } | null;
  redisStatus: 'connected' | 'disconnected' | 'unknown';
}

// ─── Event Timeline ──────────────────────────────────────────────

export interface SecurityEventItem {
  id: string;
  eventType: string;
  severity: SecurityEventSeverity;
  category: SecurityEventCategory;
  source: string;
  timestamp: string;
  actorType: SecurityActorType;
  ipAddress: string | null;
  userId: string | null;
  description: string | null;
  riskScore: number | null;
  correlationId: string | null;
}

export interface EventTimelineResponse {
  items: SecurityEventItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Trend Data ──────────────────────────────────────────────────

export interface TrendDataPoint {
  bucket: string;       // ISO date/hour string
  count: number;
  severity?: string;
  eventType?: string;
}

export interface TrendResponse {
  data: TrendDataPoint[];
  interval: 'hourly' | 'daily';
}

// ─── Top Offenders ───────────────────────────────────────────────

export interface TopOffender {
  actorType: SecurityActorType;
  actorId: string;       // ipAddress or userId
  count: number;
  lastSeen: string;
}

export interface TopOffendersResponse {
  items: TopOffender[];
  window: string; // e.g. '24h'
}

// ─── Block Activity ──────────────────────────────────────────────

export interface BlockActivityPoint {
  date: string;
  autoBlocks: number;
  manualBlocks: number;
  ipBlocks: number;
  phoneBlocks: number;
}

export interface BlockActivityResponse {
  data: BlockActivityPoint[];
  interval: 'daily';
}

// ─── Retention Config ────────────────────────────────────────────

export interface RetentionPolicyItem {
  id?: string;
  category: SecurityEventCategory;
  severity: SecurityEventSeverity;
  retentionDays: number;
  criticalRetentionDays: number | null;
}

export interface RetentionConfigResponse {
  policies: RetentionPolicyItem[];
}

// ─── Event Detail ────────────────────────────────────────────────

export interface EventDetailResponse extends SecurityEventItem {
  sessionId: string | null;
  browserTrustId: string | null;
  phone: string | null;
  trustTier: string | null;
  metadata: Record<string, unknown> | null;
  metadataVersion: number;
  correlationId: string | null;
  parentCorrelationId: string | null;
  retentionOverride: boolean;
  createdAt: string;
}

// ─── Correlation Chain ───────────────────────────────────────────

export interface CorrelationNode {
  id: string;
  eventType: string;
  severity: SecurityEventSeverity;
  timestamp: string;
  description: string | null;
  depth: number; // 0 = root, 1+ = children
}
