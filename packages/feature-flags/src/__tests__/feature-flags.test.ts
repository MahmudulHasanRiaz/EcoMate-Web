import { describe, it, expect, vi } from 'vitest';
import { FeatureFlagsService } from '../index';

function createMockEngine() {
  return {
    verify: vi.fn().mockResolvedValue({
      valid: true,
      plan: { id: 'p1', name: 'Enterprise', planType: 'fixed', price: 199 },
      features: ['storefront_catalog', 'admin_products'],
      limits: { orders_per_month: 50000 },
      domains: ['example.com'],
      expiry: '2026-12-31T00:00:00Z',
    }),
    canUseFeature: vi.fn().mockReturnValue(true),
    checkLimit: vi.fn().mockReturnValue({ ok: true, allowed: 5000, current: 100, remaining: 4900 }),
    setLicense: vi.fn().mockReturnValue({ valid: false, code: 'not_verified' }),
    getLicense: vi.fn().mockReturnValue(null),
  };
}

describe('FeatureFlagsService', () => {
  it('returns valid license after initialize', async () => {
    const engine = createMockEngine();
    const svc = new FeatureFlagsService(engine);
    expect(svc.getLicense()).toBeNull();

    await svc.initialize('test-license-key', 'example.com');
    const license = svc.getLicense();
    expect(license?.valid).toBe(true);
    expect(license?.plan?.name).toBe('Enterprise');
    expect(engine.verify).toHaveBeenCalledWith('test-license-key', 'example.com', undefined);
  });

  it('delegates canUse to license engine', async () => {
    const engine = createMockEngine();
    const svc = new FeatureFlagsService(engine);
    await svc.initialize('test-license-key');
    expect(svc.canUse('storefront_catalog')).toBe(true);
    expect(engine.canUseFeature).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true }),
      'storefront_catalog',
    );
  });

  it('returns null license before initialize call', () => {
    const svc = new FeatureFlagsService(createMockEngine());
    expect(svc.getLicense()).toBeNull();
  });

  it('returns false for canUse when no license set', () => {
    const svc = new FeatureFlagsService(createMockEngine());
    expect(svc.canUse('storefront_catalog')).toBe(false);
  });
});
