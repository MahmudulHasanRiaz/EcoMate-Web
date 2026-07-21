import { TrustTier } from './trust-tier.enum';

export interface TierLimit {
  limit: number;
  windowMs: number;
}

export interface RiskScoreConfig {
  violationWeight: number;
  autoBlockThreshold: number;
  autoBlockDurationMinutes: number;
}

export interface RateLimitPolicy {
  name: string;
  limits: Record<TrustTier, TierLimit>;
  burst?: TierLimit;
  riskScore: RiskScoreConfig;
  trackingKey: 'identity' | 'ip';
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  total: number;
  policy: string;
  tier: TrustTier;
}

export const RATE_LIMIT_POLICY_KEY = 'rate_limit_policy';
