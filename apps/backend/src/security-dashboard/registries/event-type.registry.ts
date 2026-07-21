/**
 * Centralized registry for all SecurityEvent event types.
 *
 * Every security-domain event MUST use a type from this registry.
 * Adding a new type here is sufficient — no schema changes needed.
 * DB stores the string value, application enforces the constant.
 */
export const SecurityEventType = {
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',

  // Risk score
  RISK_SCORE_VIOLATION: 'risk_score_violation',
  RISK_SCORE_RESET: 'risk_score_reset',

  // Block lifecycle
  AUTO_BLOCK_CREATED: 'auto_block_created',
  AUTO_BLOCK_EXPIRED: 'auto_block_expired',
  BLOCK_CREATED_MANUAL: 'block_created_manual',
  BLOCK_UNBLOCKED: 'block_unblocked',

  // Whitelist
  WHITELIST_TOGGLED: 'whitelist_toggled',

  // Auth
  FAILED_LOGIN: 'failed_login',
  LOGIN_SUCCESS: 'login_success',

  // Trust tier
  SESSION_PROMOTED: 'session_promoted',
  BROWSER_TRUST_PROMOTED: 'browser_trust_promoted',

  // Future — placeholders for upcoming features
  // WAF_BLOCKED: 'waf_blocked',
  // BOT_DETECTED: 'bot_detected',
  // GEO_ANOMALY: 'geo_anomaly',
  // DEVICE_FINGERPRINT_CHANGE: 'device_fingerprint_change',
  // THREAT_INTEL_MATCH: 'threat_intel_match',
} as const;

export type SecurityEventType =
  (typeof SecurityEventType)[keyof typeof SecurityEventType];
