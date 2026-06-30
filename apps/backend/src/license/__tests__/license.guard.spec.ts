import { Test, TestingModule } from '@nestjs/testing';
import { LicenseGuard } from '../license.guard';
import { LicenseActivationService } from '../license-activation.service';
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

  it('allows when activation is active', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue({ status: 'active' });
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });
});
