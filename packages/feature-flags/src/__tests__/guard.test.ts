import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FeatureGuard } from '../guard';
import { FeatureFlagsService } from '../feature-flags.service';

function createMockReflector(featureMeta?: { feature: string; dependencies: string[] }) {
  return {
    getAllAndOverride: vi.fn().mockReturnValue(featureMeta ?? null),
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
  it('allows when no feature metadata is set', () => {
    const reflector = createMockReflector(undefined);
    const flags = new FeatureFlagsService();
    const guard = new FeatureGuard(reflector as any, createMockModuleRef(flags) as any);
    expect(guard.canActivate(createMockContext())).toBe(true);
  });

  it('denies when feature is not in active set', () => {
    const reflector = createMockReflector({ feature: 'premium_feature', dependencies: [] });
    const flags = new FeatureFlagsService();
    flags.setLicense(['admin_products']);
    const guard = new FeatureGuard(reflector as any, createMockModuleRef(flags) as any);
    expect(() => guard.canActivate(createMockContext())).toThrow(ForbiddenException);
  });

  it('allows when feature is in active set', () => {
    const reflector = createMockReflector({ feature: 'admin_products', dependencies: [] });
    const flags = new FeatureFlagsService();
    flags.setLicense(['admin_products']);
    const guard = new FeatureGuard(reflector as any, createMockModuleRef(flags) as any);
    expect(guard.canActivate(createMockContext())).toBe(true);
  });
});
