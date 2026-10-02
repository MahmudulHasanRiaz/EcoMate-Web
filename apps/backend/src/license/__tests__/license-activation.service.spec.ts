import { Test, TestingModule } from '@nestjs/testing';
import { LicenseActivationService } from '../license-activation.service';
import { EncryptionService } from '../../common/utils/encryption';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('LicenseActivationService', () => {
  let service: LicenseActivationService;
  let prisma: PrismaService;

  const mockPrisma = {
    licenseActivation: {
      upsert: jest.fn(),
      // find() reads the singleton row first, then falls back to the earliest
      // legacy row for databases written by the old create-path.
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    // Sibling of licenseActivation, not nested inside it.
    licenseActivationHistory: {
      create: jest.fn().mockResolvedValue({ id: 'hist-1' }),
    },
  };

  beforeAll(() => {
    process.env.LICENSE_ENCRYPTION_KEY =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseActivationService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: (val: string) => `enc:${val}`,
            decrypt: (val: string) => val.replace('enc:', ''),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: () =>
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
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

  it('activate upserts an encrypted activation record on the singleton id', async () => {
    const dto = {
      licenseKey: 'TEST-KEY-1234',
      keymateUrl: 'https://keymate.example.com/api/v1/saas',
      domain: 'client-store.com',
      apiKey: 'test-api-token',
      licenseInfo: { valid: true, plan: { name: 'Growth' } },
    };

    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    mockPrisma.licenseActivation.upsert.mockResolvedValue({
      id: 'singleton',
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

    // Upsert on a fixed id, not create: two concurrent activations must not be
    // able to insert two rows on a table with no unique constraint.
    expect(mockPrisma.licenseActivation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'singleton' } }),
    );
    expect(mockPrisma.licenseActivation.create).not.toHaveBeenCalled();
  });

  it('records who activated the license, and a fingerprint of the key', async () => {
    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    mockPrisma.licenseActivation.upsert.mockResolvedValue({ id: 'singleton', status: 'active' });

    await service.activate({
      licenseKey: 'TEST-KEY-1234',
      keymateUrl: 'https://keymate.example.com/api/v1/saas',
      domain: 'client-store.com',
      actorUserId: 'user-1',
      actorIp: '203.0.113.9',
    });

    const history = mockPrisma.licenseActivationHistory.create.mock.calls[0][0].data;
    expect(history.actorUserId).toBe('user-1');
    expect(history.actorIp).toBe('203.0.113.9');
    expect(history.action).toBe('activated');
    // A fingerprint, never the key itself.
    expect(history.licenseKeyFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not fail the activation when the audit write fails', async () => {
    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    mockPrisma.licenseActivation.upsert.mockResolvedValue({ id: 'singleton', status: 'active' });
    mockPrisma.licenseActivationHistory.create.mockRejectedValue(new Error('audit table down'));

    // The license is already valid at this point; failing the request would
    // leave the deployment activated but reported as an error to the operator.
    await expect(
      service.activate({
        licenseKey: 'TEST-KEY-1234',
        keymateUrl: 'https://keymate.example.com/api/v1/saas',
      }),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('getDecryptedCredentials returns null when no activation', async () => {
    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    const result = await service.getDecryptedCredentials();
    expect(result).toBeNull();
  });
});
