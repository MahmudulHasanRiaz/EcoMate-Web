import { SecurityEventSeverity, SecurityEventCategory, SecurityActorType } from '@prisma/client';
import type { SecurityEventType } from '../registries/event-type.registry';
import type { SecurityEventSource } from '../registries/source.registry';

/**
 * Input contract for emitting a security event.
 * All validation happens at the emitter — the processor trusts the data.
 */
export interface EmitSecurityEventInput {
  eventType: SecurityEventType;
  severity: SecurityEventSeverity;
  category: SecurityEventCategory;
  source: SecurityEventSource;

  actorType: SecurityActorType;
  ipAddress?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  browserTrustId?: string | null;
  phone?: string | null;
  trustTier?: string | null;

  riskScore?: number | null;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
  parentCorrelationId?: string | null;
  description?: string | null;

  /** Defaults to false. Set true for events that must survive standard retention */
  retentionOverride?: boolean;
}

/**
 * Lightweight return from the emitter — just enough for logging/tracing.
 */
export interface EmitEventResult {
  id: string;
  dedupKey: string;
  enqueued: boolean;
}
