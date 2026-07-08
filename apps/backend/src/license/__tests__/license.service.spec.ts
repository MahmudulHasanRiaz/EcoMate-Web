import { Test, TestingModule } from '@nestjs/testing';
import { LicenseService } from '../license.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';
import { LicenseActivationService } from '../license-activation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LicenseService', () => {
  let service: LicenseService;

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
});
