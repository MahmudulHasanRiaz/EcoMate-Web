import { CachePurgeService } from '../cache-purge.service';
import { CacheService } from '../../cache/cache.service';

/**
 * Cache-purge service tests (P0 stale-bundle round, 2026-11-12).
 *
 * The button must report what it actually purged per layer and never a
 * silent success: every layer reports purged / not_configured / failed,
 * and a failure in one layer must not stop the other layers (the version
 * bump — the mechanism that wakes stale devices — always runs last).
 *
 * The Cloudflare token is owner-held and NOT in the repo: with no
 * CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID configured the Cloudflare
 * layer must report `not_configured` with an owner-side step, never
 * silently skip and never invent a token.
 */

const ORIGINAL_ENV = { ...process.env };

function mockFetchOnce(responses: Array<{ ok: boolean; status: number; body: any }>) {
  const calls: Array<{ url: string; init: any }> = [];
  const queue = [...responses];
  const fetchMock = jest.fn(async (url: string, init?: any) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { ok: true, status: 200, body: {} };
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  });
  (global as any).fetch = fetchMock;
  return { fetchMock, calls };
}

describe('CachePurgeService', () => {
  let service: CachePurgeService;
  let prisma: any;
  let cache: jest.Mocked<Pick<CacheService, 'clearAll'>>;
  let versionCounter = 1000;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env['CLOUDFLARE_API_TOKEN'];
    delete process.env['CLOUDFLARE_ZONE_ID'];
    delete process.env['REVALIDATION_SECRET'];
    delete process.env['STOREFRONT_URL'];
    delete process.env['CLIENT_DOMAIN'];
    versionCounter = 1000;

    prisma = {
      systemSetting: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.key === 'cache_version')
            return { key: 'cache_version', value: String(versionCounter) };
          return null;
        }),
        upsert: jest.fn(async ({ create }: any) => {
          versionCounter = Number(create.value);
          return { key: 'cache_version', value: create.value };
        }),
      },
    };
    cache = {
      clearAll: jest.fn(async () => ({
        memoryCleared: 12,
        redisDeleted: 34,
        redisSkipped: 5,
        redisAvailable: true,
      })),
    };
    service = new CachePurgeService(prisma, cache as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
    delete (global as any).fetch;
  });

  it('purges every layer when everything is configured', async () => {
    process.env['CLOUDFLARE_API_TOKEN'] = 'cf-token';
    process.env['CLOUDFLARE_ZONE_ID'] = 'zone-1';
    process.env['REVALIDATION_SECRET'] = 'reval-secret';
    process.env['STOREFRONT_URL'] = 'https://shop.example.com';
    const { fetchMock, calls } = mockFetchOnce([
      { ok: true, status: 200, body: { success: true, errors: [] } },
      { ok: true, status: 200, body: { revalidated: true } },
    ]);

    const result = await service.purgeAll();

    expect(result.layers.backendCache.status).toBe('purged');
    expect(result.layers.backendCache.detail).toContain('12');
    expect(result.layers.cloudflare.status).toBe('purged');
    expect(result.layers.storefront.status).toBe('purged');
    expect(result.layers.versionBump.status).toBe('purged');
    expect(Number(result.version)).toBeGreaterThan(1000);
    expect(result.storefrontUrl).toBe('https://shop.example.com');

    // Cloudflare: purge_everything on the tenant zone, Bearer token header.
    expect(calls[0].url).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache',
    );
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['Authorization']).toBe('Bearer cf-token');
    expect(JSON.parse(calls[0].init.body)).toEqual({ purge_everything: true });
    // The token must never appear in the reported detail.
    expect(result.layers.cloudflare.detail).not.toContain('cf-token');

    // Storefront: revalidate products + config with the shared secret.
    expect(calls[1].url).toBe(
      'https://shop.example.com/api/revalidate?tags=products,config',
    );
    expect(calls[1].init.headers['x-revalidation-secret']).toBe('reval-secret');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports Cloudflare as not_configured (never silent) when no token is set', async () => {
    process.env['REVALIDATION_SECRET'] = 'reval-secret';
    process.env['STOREFRONT_URL'] = 'https://shop.example.com';
    mockFetchOnce([{ ok: true, status: 200, body: { revalidated: true } }]);

    const result = await service.purgeAll();

    expect(result.layers.cloudflare.status).toBe('not_configured');
    expect(result.layers.cloudflare.detail).toContain('CLOUDFLARE_API_TOKEN');
    expect(result.layers.cloudflare.detail).toContain('CLOUDFLARE_ZONE_ID');
    // Every other layer still ran.
    expect(result.layers.backendCache.status).toBe('purged');
    expect(result.layers.storefront.status).toBe('purged');
    expect(result.layers.versionBump.status).toBe('purged');
  });

  it('reports a Cloudflare API error as failed and still bumps the version', async () => {
    process.env['CLOUDFLARE_API_TOKEN'] = 'cf-token';
    process.env['CLOUDFLARE_ZONE_ID'] = 'zone-1';
    mockFetchOnce([
      {
        ok: false,
        status: 403,
        body: { success: false, errors: [{ message: 'Invalid API Token' }] },
      },
    ]);

    const result = await service.purgeAll();

    expect(result.layers.cloudflare.status).toBe('failed');
    expect(result.layers.cloudflare.detail).toContain('Invalid API Token');
    expect(result.layers.cloudflare.detail).not.toContain('cf-token');
    expect(result.layers.versionBump.status).toBe('purged');
    expect(result.layers.backendCache.status).toBe('purged');
  });

  it('purges every configured zone id (comma-separated) and reports the count', async () => {
    process.env['CLOUDFLARE_API_TOKEN'] = 'cf-token';
    process.env['CLOUDFLARE_ZONE_ID'] = 'zone-1, zone-2';
    const { fetchMock } = mockFetchOnce([
      { ok: true, status: 200, body: { success: true, errors: [] } },
      { ok: true, status: 200, body: { success: true, errors: [] } },
    ]);

    const result = await service.purgeAll();

    expect(result.layers.cloudflare.status).toBe('purged');
    expect(result.layers.cloudflare.detail).toContain('2 Cloudflare zones');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports the storefront layer as not_configured when no revalidation secret is set', async () => {
    process.env['STOREFRONT_URL'] = 'https://shop.example.com';
    const { fetchMock } = mockFetchOnce([]);

    const result = await service.purgeAll();

    expect(result.layers.storefront.status).toBe('not_configured');
    expect(result.layers.storefront.detail).toContain('REVALIDATION_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a storefront fetch failure as failed and keeps going', async () => {
    process.env['REVALIDATION_SECRET'] = 'reval-secret';
    process.env['STOREFRONT_URL'] = 'https://shop.example.com';
    (global as any).fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const result = await service.purgeAll();

    expect(result.layers.storefront.status).toBe('failed');
    expect(result.layers.versionBump.status).toBe('purged');
  });

  it('reports a backend-cache failure as failed and keeps going', async () => {
    cache.clearAll.mockRejectedValueOnce(new Error('Redis down'));

    const result = await service.purgeAll();

    expect(result.layers.backendCache.status).toBe('failed');
    expect(result.layers.backendCache.detail).toContain('Redis down');
    expect(result.layers.versionBump.status).toBe('purged');
  });

  it('resolves the storefront URL from CLIENT_DOMAIN when STOREFRONT_URL is unset', async () => {
    process.env['CLIENT_DOMAIN'] = 'shop.example.com';
    process.env['REVALIDATION_SECRET'] = 'reval-secret';
    const { calls } = mockFetchOnce([
      { ok: true, status: 200, body: { revalidated: true } },
    ]);

    const result = await service.purgeAll();

    expect(result.storefrontUrl).toBe('https://shop.example.com');
    expect(calls[0].url).toContain('https://shop.example.com/api/revalidate');
  });

  it('prefers the stored storefront_url setting over the env URL', async () => {
    process.env['STOREFRONT_URL'] = 'https://env.example.com';
    process.env['REVALIDATION_SECRET'] = 'reval-secret';
    prisma.systemSetting.findUnique = jest.fn(async ({ where }: any) => {
      if (where.key === 'storefront_url')
        return { key: 'storefront_url', value: 'https://settings.example.com' };
      if (where.key === 'cache_version')
        return { key: 'cache_version', value: String(versionCounter) };
      return null;
    });
    const { calls } = mockFetchOnce([
      { ok: true, status: 200, body: { revalidated: true } },
    ]);

    const result = await service.purgeAll();

    expect(result.storefrontUrl).toBe('https://settings.example.com');
    expect(calls[0].url).toContain('https://settings.example.com/api/revalidate');
  });

  it('bumps the version strictly monotonically even within the same millisecond', async () => {
    const first = await service.purgeAll();
    const second = await service.purgeAll();
    expect(Number(second.version)).toBeGreaterThan(Number(first.version));
  });

  it('getCacheVersion returns the stored version, and null when never purged', async () => {
    await expect(service.getCacheVersion()).resolves.toEqual({
      version: '1000',
    });
    prisma.systemSetting.findUnique = jest.fn(async () => null);
    await expect(service.getCacheVersion()).resolves.toEqual({ version: null });
  });
});
