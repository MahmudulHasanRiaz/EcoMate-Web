import { Test, TestingModule } from '@nestjs/testing';
import { CourierTokenService } from './courier-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

describe('CourierTokenService (Pathao OAuth store)', () => {
  let service: CourierTokenService;
  let prisma: any;
  let cache: any;

  const baseUrl = 'https://courier-api-sandbox.pathao.com';
  const creds = {
    courier: 'pathao',
    baseUrl,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    username: 'user@merchant.com',
    password: 'pass',
  };

  const futureRow = {
    courier: 'pathao',
    accessToken: 'DB-TOKEN',
    refreshToken: 'REFRESH-1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };

  const expiredRow = {
    courier: 'pathao',
    accessToken: 'OLD-TOKEN',
    refreshToken: 'REFRESH-1',
    expiresAt: new Date(Date.now() - 1000),
  };

  function tokenResponse(token: string, refresh: string) {
    return {
      ok: true,
      json: async () => ({
        token_type: 'Bearer',
        expires_in: 432000,
        access_token: token,
        refresh_token: refresh,
      }),
    };
  }

  beforeEach(async () => {
    prisma = {
      courierAuthToken: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    // Loud default: any fetch call outside a deliberately mocked scenario is
    // a regression signal.
    global.fetch = jest.fn().mockImplementation(async () => {
      throw new Error('fetch should not be called in this test');
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<CourierTokenService>(CourierTokenService);
  });

  afterEach(() => {
    // @ts-expect-error allow resetting global fetch
    delete global.fetch;
  });

  it('returns a fresh DB token without calling the courier API', async () => {
    prisma.courierAuthToken.findUnique.mockResolvedValue(futureRow);

    const token = await service.getAccessToken(creds);

    expect(token).toBe('DB-TOKEN');
    expect(global.fetch).not.toHaveBeenCalled();
    // Populates the volatile cache for subsequent fast hits.
    expect(cache.set).toHaveBeenCalledWith(
      'courier:token:pathao',
      'DB-TOKEN',
      expect.any(Number),
    );
  });

  it('returns a valid Redis-cached token without touching the DB', async () => {
    cache.get.mockResolvedValue('REDIS-TOKEN');

    const token = await service.getAccessToken(creds);

    expect(token).toBe('REDIS-TOKEN');
    expect(prisma.courierAuthToken.findUnique).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses the refresh_token grant when the stored token is expired', async () => {
    prisma.courierAuthToken.findUnique.mockResolvedValue(expiredRow);
    global.fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      expect(String(url)).toContain('/aladdin/api/v1/issue-token');
      const body = JSON.parse(opts.body);
      expect(body.grant_type).toBe('refresh_token');
      expect(body.refresh_token).toBe('REFRESH-1');
      expect(body.client_id).toBe('client-id');
      expect(body.client_secret).toBe('client-secret');
      return tokenResponse('NEW-TOKEN', 'REFRESH-2');
    });

    const token = await service.getAccessToken(creds);

    expect(token).toBe('NEW-TOKEN');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(prisma.courierAuthToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courier: 'pathao' },
        update: expect.objectContaining({
          accessToken: 'NEW-TOKEN',
          refreshToken: 'REFRESH-2',
        }),
      }),
    );
  });

  it('falls back to the password grant when the refresh grant fails', async () => {
    prisma.courierAuthToken.findUnique.mockResolvedValue(expiredRow);
    const bodies: any[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      bodies.push(JSON.parse(opts.body));
      if (bodies.length === 1) {
        return { ok: false, status: 400, text: async () => 'invalid refresh token' };
      }
      expect(bodies[1].grant_type).toBe('password');
      return tokenResponse('PASSWORD-TOKEN', 'REFRESH-3');
    });

    const token = await service.getAccessToken(creds);

    expect(token).toBe('PASSWORD-TOKEN');
    expect(bodies[0].grant_type).toBe('refresh_token');
    expect(bodies[1].grant_type).toBe('password');
    expect(prisma.courierAuthToken.upsert).toHaveBeenCalled();
  });

  it('issues a fresh password token with no stored row and persists it', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      expect(body.grant_type).toBe('password');
      expect(body.username).toBe('user@merchant.com');
      return tokenResponse('FRESH-TOKEN', 'REFRESH-4');
    });

    const token = await service.getAccessToken(creds);

    expect(token).toBe('FRESH-TOKEN');
    expect(prisma.courierAuthToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          accessToken: 'FRESH-TOKEN',
          refreshToken: 'REFRESH-4',
        }),
      }),
    );
    // TTL honors expires_in minus a safety margin.
    const upsertArg = (prisma.courierAuthToken.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertArg.update.expiresAt.getTime()).toBeGreaterThan(Date.now() + 4 * 24 * 60 * 60 * 1000);
    expect(cache.set).toHaveBeenCalledWith('courier:token:pathao', 'FRESH-TOKEN', expect.any(Number));
  });

  it('dedupes concurrent requests into a single token fetch', async () => {
    global.fetch = jest.fn().mockImplementation(async () => tokenResponse('ONCE-TOKEN', 'R'));
    const results = await Promise.all([
      service.getAccessToken(creds),
      service.getAccessToken(creds),
      service.getAccessToken(creds),
    ]);
    expect(results).toEqual(['ONCE-TOKEN', 'ONCE-TOKEN', 'ONCE-TOKEN']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates a first-time auth failure instead of masking it', async () => {
    prisma.courierAuthToken.findUnique.mockResolvedValue(null);
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid credentials',
    }));

    await expect(service.getAccessToken(creds)).rejects.toThrow(/HTTP 401/);
  });
});