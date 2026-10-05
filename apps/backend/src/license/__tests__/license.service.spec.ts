import { Test, TestingModule } from '@nestjs/testing';
import { LicenseService, normalizeDomain } from '../license.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';
import { LicenseActivationService } from '../license-activation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LicenseService', () => {
  let service: LicenseService;
  let flags: FeatureFlagsService;

  const mockActivation = {
    find: jest.fn(),
    getDecryptedCredentials: jest.fn(),
    activate: jest.fn(),
    updateLicenseInfo: jest.fn(),
    deactivate: jest.fn(),
  };

  const mockPrisma = {
    license: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    isRestoreWriteBlocked: jest.fn().mockResolvedValue(false),
  };

  /** Engine stub whose verify() result is set per test. */
  const mockEngine = {
    verify: jest.fn(),
    canUseFeature: (license: any, key: string) =>
      license?.features?.includes(key) ?? false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.isRestoreWriteBlocked.mockResolvedValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        {
          provide: FeatureFlagsService,
          useFactory: () => new FeatureFlagsService(mockEngine as any),
        },
        { provide: ConfigService, useValue: { get: () => null } },
        { provide: LicenseActivationService, useValue: mockActivation },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<LicenseService>(LicenseService);
    flags = module.get<FeatureFlagsService>(FeatureFlagsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getStatus returns active property', () => {
    const status = service.getStatus();
    expect(status).toHaveProperty('active');
  });

  it('activateWithKeymate handles engine unavailable', async () => {
    // No LicenseEngine injected — initializeWithEngine reports engine_unavailable.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        {
          provide: FeatureFlagsService,
          useFactory: () => new FeatureFlagsService(),
        },
        { provide: ConfigService, useValue: { get: () => null } },
        { provide: LicenseActivationService, useValue: mockActivation },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    const svc = module.get<LicenseService>(LicenseService);
    const result = await svc.activateWithKeymate('test-key', 'test.com');
    expect(result.success).toBe(false);
    expect(result.error).toBe('engine_unavailable');
  });

  describe('normalizeDomain', () => {
    it('lowercases and strips the port', () => {
      expect(normalizeDomain('Store.Example.com:4000')).toBe(
        'store.example.com',
      );
    });

    it('keeps IPv6 literals intact', () => {
      expect(normalizeDomain('[::1]:4000')).toBe('[::1]');
    });

    it('returns undefined for empty input', () => {
      expect(normalizeDomain('')).toBeUndefined();
      expect(normalizeDomain(null)).toBeUndefined();
    });
  });

  describe('sync()', () => {
    const validLicense = {
      valid: true,
      features: ['admin_hr'],
      plan: { name: 'Test' },
      expiry: null,
    };

    beforeEach(() => {
      mockActivation.find.mockResolvedValue({
        id: 'singleton',
        status: 'invalid',
        errorMessage: 'unreachable',
      });
      mockActivation.getDecryptedCredentials.mockResolvedValue({
        licenseKey: 'KEY-1',
        keymateUrl: 'https://keymate',
        domain: 'licensed.example.com',
        apiKey: undefined,
        licenseInfo: null,
        status: 'invalid',
        errorMessage: 'unreachable',
      });
    });

    it('recovers from status=invalid and re-validates the stored key', async () => {
      mockEngine.verify.mockResolvedValue(validLicense);
      const result = await service.sync('current.example.com');

      expect(result.success).toBe(true);
      // The deadlock guard: the stored key was re-verified even though the row
      // was invalid, and the success was persisted with a fresh check-in.
      expect(mockActivation.activate).toHaveBeenCalledWith(
        expect.objectContaining({ licenseKey: 'KEY-1' }),
      );
      expect(mockActivation.updateLicenseInfo).toHaveBeenCalled();
    });

    it('tries the current domain first and falls back to the stored domain on mismatch', async () => {
      mockEngine.verify
        .mockResolvedValueOnce({ valid: false, code: 'domain_mismatch' })
        .mockResolvedValueOnce(validLicense);

      const result = await service.sync('current.example.com');

      expect(result.success).toBe(true);
      expect(mockEngine.verify.mock.calls[0][1]).toBe('current.example.com');
      expect(mockEngine.verify.mock.calls[1][1]).toBe('licensed.example.com');
    });

    it('persists only terminal failures; transient codes leave the row untouched', async () => {
      mockEngine.verify.mockResolvedValue({
        valid: false,
        code: 'unreachable',
      });
      const result = await service.sync('current.example.com');

      expect(result.success).toBe(false);
      expect(mockActivation.deactivate).not.toHaveBeenCalled();
    });

    it('persists terminal failures like expired', async () => {
      mockEngine.verify.mockResolvedValue({ valid: false, code: 'expired' });
      const result = await service.sync('current.example.com');

      expect(result.success).toBe(false);
      expect(mockActivation.deactivate).toHaveBeenCalledWith('expired');
    });

    it('reports not_found honestly when no row exists', async () => {
      mockActivation.find.mockResolvedValue(null);
      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.error).toBe('not_found');
      expect(mockEngine.verify).not.toHaveBeenCalled();
    });
  });

  describe("'*' wildcard license", () => {
    it('keeps the wildcard in getActiveFeatures instead of collapsing to []', () => {
      flags.setLicense(['*']);
      // A '*' license must stay open everywhere; dropping it silently closed
      // every feature for the whole install.
      expect(flags.getActiveFeatures()).toEqual(['*']);
    });

    it('permits every feature key when the license carries the wildcard', () => {
      flags.setLicense(['*']);
      expect(flags.canUse('admin_hr')).toBe(true);
      expect(flags.canUse('admin_payroll')).toBe(true);
      expect(flags.canUse('anything_at_all')).toBe(true);
    });

    it('surfaces the wildcard at the top level of /license/status', () => {
      flags.setLicense(['*']);
      const status = service.getStatus();
      expect(status.active).toBe(true);
      expect(status.features).toEqual(['*']);
    });

    it('still gates individual features on a non-wildcard license', () => {
      flags.setLicense(['admin_hr']);
      expect(flags.canUse('admin_hr')).toBe(true);
      expect(flags.canUse('admin_payroll')).toBe(false);
      expect(service.getStatus().features).toEqual(['admin_hr']);
    });
  });
});
