import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MarketingConnectionsService } from './marketing-connections.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingPlatformsService } from './marketing-platforms.service';
import { MetaGraphService } from './meta-graph.service';
import { EncryptionService } from '../common/utils/encryption';

describe('MarketingConnectionsService', () => {
  let service: MarketingConnectionsService;
  let prisma: PrismaService;
  let metaGraph: MetaGraphService;

  const mockEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
  } as unknown as EncryptionService;

  const mockPlatform = { id: 'plat-fb', slug: 'facebook', name: 'Facebook' };

  const mockPrisma = () => ({
    marketingPlatform: { findUnique: jest.fn() },
    marketingConnection: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    marketingAuditLog: { create: jest.fn() },
    adAccount: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingConnectionsService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: MarketingPlatformsService, useValue: { ensureDefaults: jest.fn() } },
        { provide: MetaGraphService, useValue: { validateToken: jest.fn(), listAdAccounts: jest.fn() } },
        { provide: EncryptionService, useValue: mockEncryption },
      ],
    }).compile();
    service = module.get(MarketingConnectionsService);
    prisma = module.get(PrismaService);
    metaGraph = module.get(MetaGraphService);
  });

  afterEach(() => jest.clearAllMocks());

  it('stores tokens ENCRYPTED at rest and sanitizes them on every response', async () => {
    (prisma.marketingPlatform.findUnique as jest.Mock).mockResolvedValue(mockPlatform);
    (metaGraph.validateToken as jest.Mock).mockResolvedValue({ id: 'user-123' });
    (prisma.marketingConnection.create as jest.Mock).mockImplementation(async ({ data }: any) => ({
      id: 'conn-1',
      platform: mockPlatform,
      _count: { adAccounts: 0 },
      ...data,
    }));

    const res = await service.create(
      { provider: 'facebook', name: 'Meta', accessToken: 'EAAG-secret-token' },
      'user-1',
    );

    const createArgs = (prisma.marketingConnection.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.accessTokenEnc).toBe('enc:EAAG-secret-token');
    expect(createArgs.data.accessToken).toBeUndefined();
    // Response never leaks the raw or even encrypted token.
    expect(JSON.stringify(res)).not.toContain('EAAG-secret-token');
    expect(JSON.stringify(res)).not.toContain('accessTokenEnc');
    expect(res.providerUserId).toBe('user-123');
  });

  it('validates the token with Meta before persisting', async () => {
    (prisma.marketingPlatform.findUnique as jest.Mock).mockResolvedValue(mockPlatform);
    (metaGraph.validateToken as jest.Mock).mockRejectedValue(new Error('Invalid OAuth 2.0 Access Token'));
    await expect(
      service.create({ provider: 'facebook', accessToken: 'bad-token' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.marketingConnection.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported providers', async () => {
    (prisma.marketingPlatform.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      service.create({ provider: 'snapchat', accessToken: 'x' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('disconnect keeps the connection row (history preserved), just flips status', async () => {
    (prisma.marketingConnection.findUnique as jest.Mock).mockResolvedValue({
      id: 'conn-1',
      status: 'connected',
      platform: mockPlatform,
    });
    (prisma.marketingConnection.update as jest.Mock).mockImplementation(async ({ data }: any) => ({
      id: 'conn-1',
      status: data.status,
      platform: mockPlatform,
    }));
    const res = await service.disconnect('conn-1', 'user-1');
    expect(res.status).toBe('disconnected');
    expect(prisma.marketingConnection.delete).not.toHaveBeenCalled();
  });

  it('getDecryptedToken decrypts both token and refresh token', async () => {
    const res = service.getDecryptedToken({
      accessTokenEnc: 'enc:abc',
      refreshTokenEnc: 'enc:def',
    });
    expect(res).toEqual({ token: 'abc', refreshToken: 'def' });
  });

  it('getDecryptedToken handles missing refresh token', async () => {
    const res = service.getDecryptedToken({ accessTokenEnc: 'enc:abc', refreshTokenEnc: null });
    expect(res).toEqual({ token: 'abc', refreshToken: null });
  });
});