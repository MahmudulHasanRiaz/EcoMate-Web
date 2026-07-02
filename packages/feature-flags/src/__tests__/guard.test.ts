import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FeatureGuard } from '../guard';
import { FeatureFlagsService } from '../feature-flags.service';

function createMockReflector(featureKey?: string) {
  return {
    getAllAndOverride: vi.fn().mockReturnValue(featureKey ?? null),
    get: vi.fn(),
    getAll: vi.fn(),
  };
}

function createMockModuleRef(featureFlags: FeatureFlagsService) {
  return {
    get: vi.fn().mockReturnValue(featureFlags),
    introspect: vi.fn(),
    register: vi.fn(),
    resolve: vi.fn(),
    create: vi.fn(),
    isGlobal: vi.fn(),
    getOptimal: vi.fn(),
    getCached: vi.fn(),
    getImports: vi.fn(),
    getProviders: vi.fn(),
    getExports: vi.fn(),
    getControllers: vi.fn(),
    getConfig: vi.fn(),
    getGlobalProviders: vi.fn(),
  };
}

function createMockContext() {
  return {
    switchToHttp: vi.fn(),
    getHandler: vi.fn(),
    getClass: vi.fn(),
    getArgs: vi.fn(),
    getArgByIndex: vi.fn(),
    getType: vi.fn(),
  } as any;
}

describe('FeatureGuard', () => {
  it('allows when no feature key is set', () => {
    const reflector = createMockReflector(undefined);
    const flags = new FeatureFlagsService();
    const guard = new FeatureGuard(reflector as any, createMockModuleRef(flags) as any);
    expect(guard.canActivate(createMockContext())).toBe(true);
  });

  it('denies with not_verified when license is null', () => {
    const reflector = createMockReflector('admin_products');
    const flags = new FeatureFlagsService();
    const moduleRef = createMockModuleRef(flags);
    const guard = new FeatureGuard(reflector as any, moduleRef as any);
    expect(() => guard.canActivate(createMockContext())).toThrow(ForbiddenException);
    expect(() => guard.canActivate(createMockContext())).toThrow('not yet verified');
  });

  it('denies when feature is not in license', () => {
    const reflector = createMockReflector('premium_feature');
    const flags = new FeatureFlagsService();
    Object.defineProperty(flags, 'getLicense', {
      value: () => ({ valid: true, code: 'ok', features: ['admin_products'] }),
    });
    Object.defineProperty(flags, 'canUse', {
      value: () => false,
    });
    const guard = new FeatureGuard(reflector as any, createMockModuleRef(flags) as any);
    expect(() => guard.canActivate(createMockContext())).toThrow(ForbiddenException);
  });

  it('returns isReady false before initialization', () => {
    const flags = new FeatureFlagsService();
    expect(flags.isReady()).toBe(false);
  });

  it('returns isReady true after license is set', async () => {
    const engine = {
      verify: vi.fn().mockResolvedValue({ valid: true, features: ['admin_products'] }),
      canUseFeature: vi.fn().mockReturnValue(true),
      checkLimit: vi.fn(),
      setLicense: vi.fn(),
      getLicense: vi.fn(),
    };
    const flags = new FeatureFlagsService(engine as any);
    expect(flags.isReady()).toBe(false);
    await flags.initialize('test-key');
    expect(flags.isReady()).toBe(true);
  });
});
