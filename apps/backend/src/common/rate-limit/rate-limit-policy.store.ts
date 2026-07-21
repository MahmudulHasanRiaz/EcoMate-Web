import { Injectable, Logger } from '@nestjs/common';
import { TrustTier } from './trust-tier.enum';
import { RateLimitPolicy } from './rate-limit-policy.interface';
import { BlockSettingsService } from '../../block-settings/block-settings.service';

const DEFAULT_POLICIES: Record<string, Omit<RateLimitPolicy, 'name'>> = {
  /**
   * Storefront — public browsing, product pages, catalog.
   * Designed for high traffic campaigns & flash sales.
   * UNKNOWN tier alone handles 100/min × N IPs = high aggregate throughput.
   */
  storefront: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 100, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 300, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 500, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 1000, windowMs: 60000 },
    },
    burst: { limit: 50, windowMs: 10000 },
    riskScore: { violationWeight: 1, autoBlockThreshold: 20, autoBlockDurationMinutes: 60 },
    trackingKey: 'identity',
  },

  /**
   * Auth endpoints — login, register, password reset.
   * Sensitive — tight limits even for authenticated users.
   */
  auth: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 20, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 30, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 60, windowMs: 60000 },
    },
    burst: { limit: 15, windowMs: 10000 },
    riskScore: { violationWeight: 3, autoBlockThreshold: 5, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * Checkout & payment — order placement, payment initiation.
   * Strictest limits regardless of trust tier.
   */
  checkout: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 5, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 10, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 15, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 30, windowMs: 60000 },
    },
    burst: { limit: 5, windowMs: 10000 },
    riskScore: { violationWeight: 5, autoBlockThreshold: 3, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * Admin panel — management, user CRUD, settings.
   * Only accessible to authenticated admin users.
   */
  admin: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 20, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 50, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 200, windowMs: 60000 },
    },
    riskScore: { violationWeight: 2, autoBlockThreshold: 10, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * POS — point of sale operations.
   * High-volume per authenticated staff.
   */
  pos: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 10, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 30, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 60, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 300, windowMs: 60000 },
    },
    riskScore: { violationWeight: 2, autoBlockThreshold: 15, autoBlockDurationMinutes: 1440 },
    trackingKey: 'identity',
  },

  /**
   * Webhooks — payment callbacks, courier updates.
   * Signature validation is primary protection.
   */
  webhooks: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 5, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 10, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 20, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 500, windowMs: 60000 },
    },
    riskScore: { violationWeight: 10, autoBlockThreshold: 3, autoBlockDurationMinutes: 1440 },
    trackingKey: 'ip',
  },

  /**
   * Health — very high limit, never block normal checks.
   */
  health: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 100, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 100, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 100, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 100, windowMs: 60000 },
    },
    riskScore: { violationWeight: 1, autoBlockThreshold: 50, autoBlockDurationMinutes: 10 },
    trackingKey: 'ip',
  },

  /**
   * Browser trust challenge — lightweight endpoint.
   */
  browser_check: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 100, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 100, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 200, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 200, windowMs: 60000 },
    },
    riskScore: { violationWeight: 1, autoBlockThreshold: 50, autoBlockDurationMinutes: 10 },
    trackingKey: 'ip',
  },

  /**
   * General API — default for unprotected routes.
   */
  api: {
    limits: {
      [TrustTier.UNKNOWN]: { limit: 60, windowMs: 60000 },
      [TrustTier.SESSION]: { limit: 120, windowMs: 60000 },
      [TrustTier.BROWSER_TRUST]: { limit: 200, windowMs: 60000 },
      [TrustTier.AUTHENTICATED]: { limit: 500, windowMs: 60000 },
    },
    burst: { limit: 30, windowMs: 10000 },
    riskScore: { violationWeight: 1, autoBlockThreshold: 20, autoBlockDurationMinutes: 60 },
    trackingKey: 'identity',
  },
};

@Injectable()
export class RateLimitPolicyStore {
  private readonly logger = new Logger(RateLimitPolicyStore.name);
  private overrides: Record<string, Partial<Omit<RateLimitPolicy, 'name'>>> = {};

  constructor(
    private readonly blockSettings?: BlockSettingsService,
  ) {}

  get(policyName: string): RateLimitPolicy {
    const defaults = DEFAULT_POLICIES[policyName];
    if (!defaults) {
      this.logger.warn(`Unknown rate limit policy "${policyName}", falling back to api`);
      return this.get('api');
    }

    const override = this.overrides[policyName];
    if (!override) {
      return { name: policyName, ...defaults };
    }

    return {
      name: policyName,
      limits: {
        [TrustTier.UNKNOWN]: override.limits?.[TrustTier.UNKNOWN] ?? defaults.limits[TrustTier.UNKNOWN],
        [TrustTier.SESSION]: override.limits?.[TrustTier.SESSION] ?? defaults.limits[TrustTier.SESSION],
        [TrustTier.BROWSER_TRUST]: override.limits?.[TrustTier.BROWSER_TRUST] ?? defaults.limits[TrustTier.BROWSER_TRUST],
        [TrustTier.AUTHENTICATED]: override.limits?.[TrustTier.AUTHENTICATED] ?? defaults.limits[TrustTier.AUTHENTICATED],
      },
      burst: override.burst ?? defaults.burst,
      riskScore: override.riskScore ?? defaults.riskScore,
      trackingKey: override.trackingKey ?? defaults.trackingKey,
    };
  }

  listPolicies(): string[] {
    return Object.keys(DEFAULT_POLICIES);
  }

  async loadOverridesFromSettings(): Promise<void> {
    try {
      if (!this.blockSettings) return;
      const settings = await this.blockSettings.getSettings();
      const rateLimitConfig = (settings as any).rateLimitPolicies;
      if (rateLimitConfig && typeof rateLimitConfig === 'object') {
        this.overrides = rateLimitConfig;
        this.logger.log(`Loaded rate limit policy overrides from settings`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to load rate limit policy overrides: ${err.message}`);
    }
  }
}
