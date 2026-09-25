import { RateLimitPolicyStore } from './rate-limit-policy.store';
import { TrustTier } from './trust-tier.enum';

describe('RateLimitPolicyStore — store_webhook (P0)', () => {
  it('exposes a store_webhook policy distinct from generic webhooks', () => {
    const store = new RateLimitPolicyStore(undefined as any);
    expect(store.listPolicies()).toContain('store_webhook');
    const policy = store.get('store_webhook');
    expect(policy.name).toBe('store_webhook');
    expect(policy.trackingKey).toBe('ip');
    expect(policy.limits[TrustTier.UNKNOWN].limit).toBe(60);
    expect(policy.burst?.limit).toBe(20);
  });

  it('falls back to api for unknown policies', () => {
    const store = new RateLimitPolicyStore(undefined as any);
    expect(store.get('nope-not-a-policy').name).toBe('api');
  });
});
