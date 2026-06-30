import { Test, TestingModule } from '@nestjs/testing';
import { LicenseActivationService } from '../license-activation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('LicenseActivationService', () => {
  let service: LicenseActivationService;
  let prisma: PrismaService;

  const mockPrisma = {
    licenseActivation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeAll(() => {
    process.env.LICENSE_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseActivationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
      ],
    }).compile();
    service = module.get<LicenseActivationService>(LicenseActivationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('find returns null when no activation exists', async () => {
    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    const result = await service.find();
    expect(result).toBeNull();
  });

  it('activate creates encrypted activation record', async () => {
    const dto = {
      licenseKey: 'TEST-KEY-1234',
      keymateUrl: 'https://keymate.example.com/api/v1/saas',
      domain: 'client-store.com',
      apiKey: 'test-api-token',
      licenseInfo: { valid: true, plan: { name: 'Growth' } },
    };

    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    mockPrisma.licenseActivation.create.mockResolvedValue({
      id: 'uuid',
      licenseKey: 'encrypted:value',
      keymateUrl: dto.keymateUrl,
      domain: dto.domain,
      apiKey: 'encrypted:value',
      licenseInfo: dto.licenseInfo,
      status: 'active',
      errorMessage: null,
      activatedAt: new Date(),
      expiresAt: null,
      lastCheckIn: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.activate(dto);
    expect(result.status).toBe('active');
    expect(mockPrisma.licenseActivation.create).toHaveBeenCalled();
  });

  it('getDecryptedCredentials returns null when no activation', async () => {
    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    const result = await service.getDecryptedCredentials();
    expect(result).toBeNull();
  });
});
