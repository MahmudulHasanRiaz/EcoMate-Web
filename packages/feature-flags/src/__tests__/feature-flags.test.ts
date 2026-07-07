import { describe, it, expect, vi } from 'vitest';
import { FeatureFlagsService } from '../index';

function createMockEngine() {
  return {
    verify: vi.fn().mockResolvedValue({
      valid: true,
      plan: { id: 'p1', name: 'Enterprise', planType: 'fixed', price: 199 },
      features: ['storefront', 'admin_products'],
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
    const svc = new FeatureFlagsService(engine as any);
    expect(svc.getLicense()).toBeNull();

    await svc.initialize('test-license-key', 'example.com');
    const license = svc.getLicense();
    expect(license?.valid).toBe(true);
    expect(license?.plan?.name).toBe('Enterprise');
    expect(engine.verify).toHaveBeenCalledWith('test-license-key', 'example.com', undefined);
  });

  it('checks feature from license list', async () => {
    const engine = createMockEngine();
    const svc = new FeatureFlagsService(engine as any);
    await svc.initialize('test-license-key');
    expect(svc.canUse('storefront')).toBe(true);
    expect(svc.canUse('admin_products')).toBe(true);
  });

  it('returns false for unlicensed feature', async () => {
    const engine = createMockEngine();
    const svc = new FeatureFlagsService(engine as any);
    await svc.initialize('test-license-key');
    expect(svc.canUse('pos_system')).toBe(false);
  });

  it('validates feature dependencies', async () => {
    const engine = createMockEngine();
    engine.verify = vi.fn().mockResolvedValue({
      valid: true,
      features: ['admin_products'],
    });
    const svc = new FeatureFlagsService(engine as any);
    await svc.initialize('test-license-key');
    expect(svc.canUse('admin_coupons')).toBe(false);
  });

  it('returns null license before initialize call', () => {
    const svc = new FeatureFlagsService(createMockEngine() as any);
    expect(svc.getLicense()).toBeNull();
  });

  it('returns false for canUse when no license set', () => {
    const svc = new FeatureFlagsService(createMockEngine() as any);
    expect(svc.canUse('storefront_catalog')).toBe(false);
  });
});
