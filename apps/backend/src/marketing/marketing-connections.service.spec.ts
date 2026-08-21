import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MarketingConnectionsService } from './marketing-connections.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingPlatformsService } from './marketing-platforms.service';
import { ProviderAdapterFactory } from './provider-factory';
import { EncryptionService } from '../common/utils/encryption';

describe('MarketingConnectionsService', () => {
  let service: MarketingConnectionsService;
  let prisma: PrismaService;
  let providerFactory: ProviderAdapterFactory;

  const mockEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
  } as unknown as EncryptionService;

  const mockPlatform = { id: 'plat-fb', slug: 'facebook', name: 'Facebook' };

  const mockAdapter = {
    providerSlug: 'facebook',
    validateConnection: jest.fn(),
    listAdAccounts: jest.fn(),
    refreshToken: jest.fn(),
    pauseCampaign: jest.fn(),
    resumeCampaign: jest.fn(),
    listCampaigns: jest.fn(),
    listAdSets: jest.fn(),
    listAds: jest.fn(),
    fetchInsights: jest.fn(),
    withTokenRefresh: jest.fn(),
  };

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
    systemSetting: { findUnique: jest.fn() },
    marketingCampaign: { findUnique: jest.fn(), update: jest.fn() },
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
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingConnectionsService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: MarketingPlatformsService, useValue: { ensureDefaults: jest.fn() } },
        { provide: ProviderAdapterFactory, useValue: { getAdapter: jest.fn().mockReturnValue(mockAdapter) } },
        { provide: EncryptionService, useValue: mockEncryption },
      ],
    }).compile();
    service = module.get(MarketingConnectionsService);
    prisma = module.get(PrismaService);
    providerFactory = module.get(ProviderAdapterFactory);
  });

  it('stores tokens ENCRYPTED at rest and sanitizes them on every response', async () => {
    (prisma.marketingPlatform.findUnique as jest.Mock).mockResolvedValue(mockPlatform);
    mockAdapter.validateConnection.mockResolvedValue({ providerUserId: 'user-123' });
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
    expect(JSON.stringify(res)).not.toContain('EAAG-secret-token');
    expect(JSON.stringify(res)).not.toContain('accessTokenEnc');
    expect(res.providerUserId).toBe('user-123');
  });

  it('validates the token with provider before persisting', async () => {
    (prisma.marketingPlatform.findUnique as jest.Mock).mockResolvedValue(mockPlatform);
    mockAdapter.validateConnection.mockRejectedValue(new Error('Invalid OAuth 2.0 Access Token'));
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

  describe('refreshLongLivedToken', () => {
    const mockSettings = () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
        const values: any = {
          marketing_app_id: { key: 'marketing_app_id', value: 'app-123' },
          marketing_app_secret: { key: 'marketing_app_secret', value: 'secret-456' },
        };
        return Promise.resolve(values[where.key] ?? null);
      });
    };

    const mockConnection = {
      id: 'conn-1',
      accessTokenEnc: 'enc:EAAG-live-token',
      platform: { slug: 'facebook' },
    };

    it('returns null without touching provider when app id or secret settings are missing', async () => {
      (prisma.marketingConnection.findUnique as jest.Mock).mockResolvedValue(mockConnection);
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await service.refreshLongLivedToken('conn-1');

      expect(res).toBeNull();
      expect(mockAdapter.refreshToken).not.toHaveBeenCalled();
      expect(prisma.marketingConnection.update).not.toHaveBeenCalled();
    });

    it('returns null for a missing connection', async () => {
      (prisma.marketingConnection.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await service.refreshLongLivedToken('conn-nope')).toBeNull();
    });

    it('exchanges the token, encrypts the new one and updates the row', async () => {
      (prisma.marketingConnection.findUnique as jest.Mock).mockResolvedValue(mockConnection);
      mockSettings();
      mockAdapter.refreshToken.mockResolvedValue({
        accessToken: 'EAAG-new-token',
        expiresIn: 5184000,
      });
      (prisma.marketingConnection.update as jest.Mock).mockImplementation(async ({ data }: any) => ({
        id: 'conn-1',
        platform: mockPlatform,
        status: data.status,
        tokenExpiry: data.tokenExpiry,
      }));
      (prisma.marketingAuditLog.create as jest.Mock).mockResolvedValue({});

      const res = await service.refreshLongLivedToken('conn-1');

      expect(mockAdapter.refreshToken).toHaveBeenCalledWith(
        'EAAG-live-token',
        'app-123',
        'secret-456',
      );
      const updateArgs = (prisma.marketingConnection.update as jest.Mock).mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'conn-1' });
      expect(updateArgs.data.accessTokenEnc).toBe('enc:EAAG-new-token');
      expect(updateArgs.data.status).toBe('connected');
      expect(updateArgs.data.tokenExpiry).toBeInstanceOf(Date);
      const expected = Date.now() + 5184000 * 1000;
      expect(Math.abs(updateArgs.data.tokenExpiry.getTime() - expected)).toBeLessThan(5000);
      expect(prisma.marketingAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'connection.token_refresh',
            entityId: 'conn-1',
          }),
        }),
      );
      expect(JSON.stringify(res)).not.toContain('accessTokenEnc');
      expect(JSON.stringify(res)).not.toContain('EAAG-new-token');
    });

    it('returns null when the provider call fails instead of throwing', async () => {
      (prisma.marketingConnection.findUnique as jest.Mock).mockResolvedValue(mockConnection);
      mockSettings();
      mockAdapter.refreshToken.mockRejectedValue(new Error('Rate limit hit'));

      const res = await service.refreshLongLivedToken('conn-1');

      expect(res).toBeNull();
      expect(prisma.marketingConnection.update).not.toHaveBeenCalled();
    });

    it('returns null when provider responds without access token', async () => {
      (prisma.marketingConnection.findUnique as jest.Mock).mockResolvedValue(mockConnection);
      mockSettings();
      mockAdapter.refreshToken.mockResolvedValue({ accessToken: null, expiresIn: 0 });

      const res = await service.refreshLongLivedToken('conn-1');

      expect(res).toBeNull();
      expect(prisma.marketingConnection.update).not.toHaveBeenCalled();
    });
  });

  describe('pauseCampaign / resumeCampaign', () => {
    const campaignWithConnection = {
      id: 'camp-1',
      providerCampaignId: '2384345',
      adAccount: {
        id: 'acct-1',
        connection: {
          id: 'conn-1',
          accessTokenEnc: 'enc:EAAG-xyz',
          platform: { slug: 'facebook' },
        },
      },
    };

    it('PAUSEs the campaign on provider and mirrors the status locally', async () => {
      (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(campaignWithConnection);
      mockAdapter.pauseCampaign.mockResolvedValue(undefined);
      (prisma.marketingCampaign.update as jest.Mock).mockResolvedValue({
        id: 'camp-1',
        status: 'PAUSED',
      });
      (prisma.marketingAuditLog.create as jest.Mock).mockResolvedValue({});

      const res = await service.pauseCampaign('camp-1', 'user-1');

      expect(res).toEqual({ ok: true, status: 'PAUSED' });
      expect(mockAdapter.pauseCampaign).toHaveBeenCalledWith('EAAG-xyz', '2384345');
      expect(prisma.marketingCampaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: expect.objectContaining({ status: 'PAUSED', effectiveStatus: 'PAUSED' }),
      });
      expect(prisma.marketingAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'campaign.pause', actorId: 'user-1' }),
        }),
      );
    });

    it('resumes an ACTIVE campaign on provider and mirrors the status locally', async () => {
      (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(campaignWithConnection);
      mockAdapter.resumeCampaign.mockResolvedValue(undefined);
      (prisma.marketingCampaign.update as jest.Mock).mockResolvedValue({
        id: 'camp-1',
        status: 'ACTIVE',
      });
      (prisma.marketingAuditLog.create as jest.Mock).mockResolvedValue({});

      const res = await service.resumeCampaign('camp-1');

      expect(res).toEqual({ ok: true, status: 'ACTIVE' });
      expect(mockAdapter.resumeCampaign).toHaveBeenCalledWith('EAAG-xyz', '2384345');
    });

    it('rejects with BadRequest when the campaign does not exist', async () => {
      (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.pauseCampaign('nope')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.resumeCampaign('nope')).rejects.toBeInstanceOf(BadRequestException);
      expect(mockAdapter.pauseCampaign).not.toHaveBeenCalled();
    });

    it('rejects with BadRequest when provider rejects the status change', async () => {
      (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(campaignWithConnection);
      mockAdapter.pauseCampaign.mockRejectedValue(new Error('Not permitted'));
      await expect(service.pauseCampaign('camp-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.marketingCampaign.update).not.toHaveBeenCalled();
    });
  });

  describe('discoverAdAccounts', () => {
    const connWithPlatform = {
      id: 'conn-1',
      accessTokenEnc: 'enc:EAAG-xyz',
      platform: mockPlatform,
    };

    beforeEach(() => {
      (prisma.marketingConnection.findUnique as jest.Mock).mockResolvedValue(connWithPlatform);
      mockAdapter.withTokenRefresh.mockImplementation((_conn: any, _decrypt: any, _refresh: any, fn: any) => fn('EAAG-xyz'));
    });

    it('creates ad accounts when provider returns valid currency', async () => {
      mockAdapter.listAdAccounts.mockResolvedValue([
        { id: 'act_111', name: 'Main Account', currency: 'BDT', timezone_name: 'Asia/Dhaka', account_status: 1 },
      ]);
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.adAccount.create as jest.Mock).mockImplementation(async ({ data }: any) => ({ id: 'acc-1', ...data }));

      const res = await service.discoverAdAccounts({ connectionId: 'conn-1' });

      expect(res.discovered).toBe(1);
      expect(res.adAccounts[0].currency).toBe('BDT');
    });

    it('skips ad accounts when provider returns no currency (financial invariant)', async () => {
      mockAdapter.listAdAccounts.mockResolvedValue([
        { id: 'act_no-currency', name: 'Test Account', currency: undefined, timezone_name: 'UTC', account_status: 1 },
      ]);
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await service.discoverAdAccounts({ connectionId: 'conn-1' });

      expect(res.discovered).toBe(0);
      expect(prisma.adAccount.create).not.toHaveBeenCalled();
    });

    it('skips only the uncurrency account and creates the valid one', async () => {
      mockAdapter.listAdAccounts.mockResolvedValue([
        { id: 'act_bad', name: 'Bad', currency: undefined, timezone_name: 'UTC', account_status: 1 },
        { id: 'act_good', name: 'Good', currency: 'USD', timezone_name: 'America/New_York', account_status: 1 },
      ]);
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.adAccount.create as jest.Mock).mockImplementation(async ({ data }: any) => ({ id: 'acc-1', ...data }));

      const res = await service.discoverAdAccounts({ connectionId: 'conn-1' });

      expect(res.discovered).toBe(1);
      expect(res.adAccounts[0].providerAccountId).toBe('act_good');
      expect(prisma.adAccount.create).toHaveBeenCalledTimes(1);
    });

    it('updates existing accounts even when currency is present', async () => {
      mockAdapter.listAdAccounts.mockResolvedValue([
        { id: 'act_111', name: 'Updated', currency: 'USD', timezone_name: 'UTC', account_status: 1 },
      ]);
      (prisma.adAccount.findUnique as jest.Mock).mockResolvedValue({ id: 'acc-existing', providerAccountId: 'act_111' });
      (prisma.adAccount.update as jest.Mock).mockImplementation(async ({ data }: any) => ({ id: 'acc-existing', ...data }));

      const res = await service.discoverAdAccounts({ connectionId: 'conn-1' });

      expect(res.discovered).toBe(1);
      expect(prisma.adAccount.create).not.toHaveBeenCalled();
      expect(prisma.adAccount.update).toHaveBeenCalled();
    });
  });
});
