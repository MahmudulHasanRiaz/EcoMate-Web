import { describe, it, expect, vi } from 'vitest';
import { FeatureFlagsService } from '../index';

function createMockEngine() {
  return {
    verify: vi.fn(() => ({
      valid: true,
      clientId: 'test-client',
      plan: 'ultimate',
      packages: [],
      customFeatures: [],
      limits: { cpus: 999, memory: '999G', users: 999, stores: 999 },
      exp: 9999999999,
    })),
    canUseFeature: vi.fn(() => true),
  };
}

describe('FeatureFlagsService', () => {
  it('returns valid license after setLicense', () => {
    const engine = createMockEngine();
    const svc = new FeatureFlagsService(engine);
    expect(svc.getLicense()).toBeNull();

    svc.setLicense('test-token');
    const license = svc.getLicense();
    expect(license?.valid).toBe(true);
    expect(license?.plan).toBe('ultimate');
  });

  it('delegates canUse to license engine', () => {
    const engine = createMockEngine();
    const svc = new FeatureFlagsService(engine);
    svc.setLicense('test-token');
    expect(svc.canUse('pos')).toBe(true);
    expect(engine.canUseFeature).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'ultimate' }),
      'pos',
    );
  });

  it('returns null license before setLicense call', () => {
    const svc = new FeatureFlagsService(createMockEngine());
    expect(svc.getLicense()).toBeNull();
  });

  it('returns false for canUse when no license set', () => {
    const svc = new FeatureFlagsService(createMockEngine());
    expect(svc.canUse('pos')).toBe(false);
  });
});
