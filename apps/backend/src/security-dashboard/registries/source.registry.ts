/**
 * Centralized registry for SecurityEvent sources.
 *
 * Identifies which component generated the event.
 * Every event source MUST use a value from this registry.
 */
export const SecurityEventSource = {
  ADAPTIVE_RATE_LIMITER: 'adaptive_rate_limiter',
  SECURITY_SERVICE: 'security_service',
  RISK_SCORE: 'risk_score',
  AUTH: 'auth',
  SYSTEM: 'system',
  MANUAL: 'manual',

  // Future sources
  WAF: 'waf',
  BOT_DETECTION: 'bot_detection',
  THREAT_INTEL: 'threat_intel',
  SIEM: 'siem',
} as const;

export type SecurityEventSource =
  (typeof SecurityEventSource)[keyof typeof SecurityEventSource];
