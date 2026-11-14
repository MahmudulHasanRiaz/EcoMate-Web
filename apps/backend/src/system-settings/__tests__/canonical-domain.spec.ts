import { SystemSettingsController } from '../system-settings.controller';

const PURGE_OK = { status: 'purged', detail: '' };

function mockCachePurge() {
  return {
    revalidateStorefront: jest.fn().mockResolvedValue(PURGE_OK),
  };
}

describe('getStorefrontConfig canonicalDomain', () => {
  let savedClientDomain: string | undefined;

  function mockController(settings: { key: string; value: string }[] = []) {
    const prisma = {
      systemSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      shippingOption: { findMany: jest.fn().mockResolvedValue([]) },
      shippingZoneGroup: { findMany: jest.fn().mockResolvedValue([]) },
      paymentOption: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      getStale: jest.fn(),
      set: jest.fn(),
    };
    return new SystemSettingsController(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      {} as any,
      mockCachePurge() as any,
    );
  }

  beforeEach(() => {
    savedClientDomain = process.env.CLIENT_DOMAIN;
  });

  afterEach(() => {
    if (savedClientDomain === undefined) delete process.env.CLIENT_DOMAIN;
    else process.env.CLIENT_DOMAIN = savedClientDomain;
  });

  it('emits a saved canonical_domain value', async () => {
    delete process.env.CLIENT_DOMAIN;
    const cfg = await mockController([
      { key: 'canonical_domain', value: 'https://shop.example.com' },
    ]).getStorefrontConfig();
    expect((cfg as any).canonicalDomain).toBe('https://shop.example.com');
  });

  it('a saved value wins over CLIENT_DOMAIN', async () => {
    process.env.CLIENT_DOMAIN = 'demo.ecomate.bd';
    const cfg = await mockController([
      { key: 'canonical_domain', value: 'https://shop.example.com' },
    ]).getStorefrontConfig();
    expect((cfg as any).canonicalDomain).toBe('https://shop.example.com');
  });

  it('derives from CLIENT_DOMAIN when unset (auto-seed on read, zero action)', async () => {
    process.env.CLIENT_DOMAIN = 'demo.ecomate.bd';
    const cfg = await mockController().getStorefrontConfig();
    expect((cfg as any).canonicalDomain).toBe('https://demo.ecomate.bd');
  });

  it('omits the key when unset and CLIENT_DOMAIN cannot derive a valid origin', async () => {
    process.env.CLIENT_DOMAIN = 'demo.ecomate.bd:3001';
    const cfg = await mockController().getStorefrontConfig();
    expect('canonicalDomain' in (cfg as any)).toBe(false);
  });

  it('omits the key when unset and CLIENT_DOMAIN is absent', async () => {
    delete process.env.CLIENT_DOMAIN;
    const cfg = await mockController().getStorefrontConfig();
    expect('canonicalDomain' in (cfg as any)).toBe(false);
  });

  it('defensively omits a stored value that no longer validates', async () => {
    delete process.env.CLIENT_DOMAIN;
    const cfg = await mockController([
      { key: 'canonical_domain', value: 'http://shop.example.com' },
    ]).getStorefrontConfig();
    expect('canonicalDomain' in (cfg as any)).toBe(false);
  });
});

describe('POST /system-settings/canonical_domain', () => {
  function mockSetController() {
    const prisma = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest
          .fn()
          .mockImplementation(async ({ create }: any) => create),
      },
    };
    const cache = { delete: jest.fn().mockResolvedValue(undefined) };
    const cachePurge = mockCachePurge();
    const ctrl = new SystemSettingsController(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      {} as any,
      cachePurge as any,
    );
    return { ctrl, prisma, cache, cachePurge };
  }

  const superadmin = { role: 'superadmin' };

  it('stores a valid value normalised (trailing slash stripped)', async () => {
    const { ctrl, prisma, cache, cachePurge } = mockSetController();
    const res = await ctrl.set(
      'canonical_domain',
      { value: 'https://Shop.Example.com/' },
      superadmin,
    );
    expect(res.value).toBe('https://shop.example.com');
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'canonical_domain' },
      create: { key: 'canonical_domain', value: 'https://shop.example.com' },
      update: { value: 'https://shop.example.com' },
    });
    expect(cache.delete).toHaveBeenCalledWith('storefront:config');
    expect(cachePurge.revalidateStorefront).toHaveBeenCalled();
  });

  it.each([
    ['http://shop.example.com', 'must use https'],
    ['https://shop.example.com:3001', 'must not include a port'],
    ['https://example.com', 'must not be example.com'],
    ['https://backend', 'not an internal host'],
    ['https://user:pass@shop.example.com', 'must not include a username'],
    ['shop.example.com', 'must be a valid URL'],
  ])('rejects %s with a precise 400 (%s)', async (value, fragment) => {
    const { ctrl, prisma } = mockSetController();
    await expect(
      ctrl.set('canonical_domain', { value }, superadmin),
    ).rejects.toThrow(fragment);
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('empty value clears the setting (upserts empty, still revalidates)', async () => {
    const { ctrl, prisma, cachePurge } = mockSetController();
    const res = await ctrl.set('canonical_domain', { value: '' }, superadmin);
    expect(res.value).toBe('');
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'canonical_domain' },
      create: { key: 'canonical_domain', value: '' },
      update: { value: '' },
    });
    expect(cachePurge.revalidateStorefront).toHaveBeenCalled();
  });

  it.each(['admin', 'employee', undefined])(
    'forbids role %s from changing the canonical domain',
    async (role) => {
      const { ctrl, prisma } = mockSetController();
      const user = role === undefined ? undefined : { role };
      await expect(
        ctrl.set('canonical_domain', { value: 'https://shop.example.com' }, user as any),
      ).rejects.toThrow('Only superadmins may change the canonical domain');
      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    },
  );

  it('does not trigger a storefront revalidation for other keys', async () => {
    const { ctrl, cachePurge } = mockSetController();
    await ctrl.set('store_name', { value: 'Shop' }, superadmin);
    expect(cachePurge.revalidateStorefront).not.toHaveBeenCalled();
  });
});
