import { Test, TestingModule } from '@nestjs/testing';
import { LicenseGuard } from '../license.guard';
import { LicenseActivationService } from '../license-activation.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SKIP_LICENSE_CHECK } from '../../common/decorators/skip-license-check.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

describe('LicenseGuard', () => {
  let guard: LicenseGuard;
  let licenseActivation: LicenseActivationService;
  let reflector: Reflector;

  const mockActivation = {
    find: jest.fn(),
  };

  const mockFeatureFlags = {
    getLicense: jest.fn(),
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const createMockContext = (): ExecutionContext =>
    ({
      getHandler: () => {},
      getClass: () => {},
    }) as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseGuard,
        { provide: LicenseActivationService, useValue: mockActivation },
        { provide: FeatureFlagsService, useValue: mockFeatureFlags },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();
    guard = module.get<LicenseGuard>(LicenseGuard);
    licenseActivation = module.get<LicenseActivationService>(LicenseActivationService);
    reflector = module.get<Reflector>(Reflector);
  });

  it('allows when SkipLicenseCheck is set', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === SKIP_LICENSE_CHECK) return true;
      return null;
    });
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });

  it('allows when route is Public', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return true;
      return null;
    });
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });

  it('blocks when no activation exists', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue(null);
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(ForbiddenException);
  });

  it('blocks when activation is not active', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue({ status: 'pending' });
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(ForbiddenException);
  });

  it('blocks when cached license is invalid (expired/revoked)', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue({ status: 'active' });
    mockFeatureFlags.getLicense.mockReturnValue({ valid: false, code: 'expired' });
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(ForbiddenException);
  });

  it('allows when activation active and cached license valid', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue({ status: 'active' });
    mockFeatureFlags.getLicense.mockReturnValue({ valid: true, plan: { name: 'Enterprise' } });
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });

  it('allows when DEV_LICENSE_BYPASS is true and not production', async () => {
    process.env.DEV_LICENSE_BYPASS = 'true';
    process.env.NODE_ENV = 'development';
    mockReflector.getAllAndOverride.mockReturnValue(null);
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
    delete process.env.DEV_LICENSE_BYPASS;
    delete process.env.NODE_ENV;
  });

  it('blocks in production even with DEV_LICENSE_BYPASS', async () => {
    process.env.DEV_LICENSE_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue(null);
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(ForbiddenException);
    delete process.env.DEV_LICENSE_BYPASS;
    delete process.env.NODE_ENV;
  });
});
