import { Test, TestingModule } from '@nestjs/testing';
import { LicenseService } from '../license.service';
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
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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
    const result = await service.activateWithKeymate('test-key', 'test.com');
    expect(result.success).toBe(false);
    expect(result.error).toBe('engine_unavailable');
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
