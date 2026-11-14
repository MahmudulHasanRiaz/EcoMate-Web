import { SystemSettingsController } from '../system-settings.controller';

describe('getStorefrontConfig searchIndexingEnabled (D7)', () => {
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
      {
        revalidateStorefront: jest.fn().mockResolvedValue({
          status: 'purged',
          detail: '',
        }),
      } as any,
    );
  }

  it("maps 'true' to enabled", async () => {
    const cfg = await mockController([
      { key: 'search_engine_indexing', value: 'true' },
    ]).getStorefrontConfig();
    expect((cfg as any).searchIndexingEnabled).toBe(true);
  });

  it("maps 'false' to disabled (fresh-tenant seed default)", async () => {
    const cfg = await mockController([
      { key: 'search_engine_indexing', value: 'false' },
    ]).getStorefrontConfig();
    expect((cfg as any).searchIndexingEnabled).toBe(false);
  });

  it('omits the key when the tenant has no stored value (pre-toggle backend keeps historic ON behaviour in the storefront)', async () => {
    const cfg = await mockController().getStorefrontConfig();
    expect('searchIndexingEnabled' in (cfg as any)).toBe(false);
  });
});

describe('POST /system-settings/search_engine_indexing — indexing-ON guard', () => {
  const GUARD_MESSAGE =
    'Search indexing can only be turned on after a canonical domain is saved in Settings → General → Canonical Domain.';

  let savedClientDomain: string | undefined;

  // Stateful store so a sequential domain-save then indexing-save behaves
  // like the real DB: findUnique reads what upsert wrote.
  function mockSetController(initial: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(initial));
    const prisma = {
      systemSetting: {
        findUnique: jest
          .fn()
          .mockImplementation(async ({ where }: any) => {
            const value = store.get(where.key);
            return value === undefined
              ? null
              : { key: where.key, value };
          }),
        upsert: jest
          .fn()
          .mockImplementation(async ({ create, update }: any) => {
            store.set(create.key, update.value);
            return { key: create.key, value: update.value };
          }),
      },
    };
    const cache = { delete: jest.fn().mockResolvedValue(undefined) };
    const cachePurge = {
      revalidateStorefront: jest
        .fn()
        .mockResolvedValue({ status: 'purged', detail: '' }),
    };
    const ctrl = new SystemSettingsController(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      {} as any,
      cachePurge as any,
    );
    return { ctrl, prisma, cache, cachePurge, store };
  }

  const superadmin = { role: 'superadmin' };

  async function expectGuardRejection(promise: Promise<unknown>) {
    let err: any;
    try {
      await promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.getStatus?.()).toBe(400);
    expect(err.message).toBe(GUARD_MESSAGE);
  }

  beforeEach(() => {
    savedClientDomain = process.env.CLIENT_DOMAIN;
  });

  afterEach(() => {
    if (savedClientDomain === undefined) delete process.env.CLIENT_DOMAIN;
    else process.env.CLIENT_DOMAIN = savedClientDomain;
  });

  it('OFF→ON with NO saved canonical_domain → 400 with the exact message, and nothing is written', async () => {
    delete process.env.CLIENT_DOMAIN;
    const { ctrl, prisma } = mockSetController({
      search_engine_indexing: 'false',
    });
    await expectGuardRejection(
      ctrl.set('search_engine_indexing', { value: 'true' }, superadmin),
    );
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('OFF→ON with a valid saved canonical_domain → resolves 200', async () => {
    delete process.env.CLIENT_DOMAIN;
    const { ctrl, prisma } = mockSetController({
      search_engine_indexing: 'false',
      canonical_domain: 'https://shop.example.com',
    });
    const res = await ctrl.set(
      'search_engine_indexing',
      { value: 'true' },
      superadmin,
    );
    expect(res).toEqual({
      key: 'search_engine_indexing',
      value: 'true',
    });
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'search_engine_indexing' },
      create: { key: 'search_engine_indexing', value: 'true' },
      update: { value: 'true' },
    });
  });

  it('sequential: save canonical_domain first, then OFF→ON → resolves 200', async () => {
    delete process.env.CLIENT_DOMAIN;
    const { ctrl, store } = mockSetController({
      search_engine_indexing: 'false',
    });
    await ctrl.set(
      'canonical_domain',
      { value: 'https://shop.example.com' },
      superadmin,
    );
    expect(store.get('canonical_domain')).toBe('https://shop.example.com');
    const res = await ctrl.set(
      'search_engine_indexing',
      { value: 'true' },
      superadmin,
    );
    expect(res).toEqual({
      key: 'search_engine_indexing',
      value: 'true',
    });
  });

  it('ON→OFF with no saved domain → resolves 200', async () => {
    delete process.env.CLIENT_DOMAIN;
    const { ctrl } = mockSetController({
      search_engine_indexing: 'true',
    });
    const res = await ctrl.set(
      'search_engine_indexing',
      { value: 'false' },
      superadmin,
    );
    expect(res).toEqual({
      key: 'search_engine_indexing',
      value: 'false',
    });
  });

  it("re-save 'true' when already 'true' with no saved domain → resolves 200", async () => {
    delete process.env.CLIENT_DOMAIN;
    const { ctrl } = mockSetController({
      search_engine_indexing: 'true',
    });
    const res = await ctrl.set(
      'search_engine_indexing',
      { value: 'true' },
      superadmin,
    );
    expect(res).toEqual({
      key: 'search_engine_indexing',
      value: 'true',
    });
  });

  it('ON with no stored indexing row (historic ON) and no saved domain → resolves 200', async () => {
    delete process.env.CLIENT_DOMAIN;
    const { ctrl } = mockSetController();
    const res = await ctrl.set(
      'search_engine_indexing',
      { value: 'true' },
      superadmin,
    );
    expect(res).toEqual({
      key: 'search_engine_indexing',
      value: 'true',
    });
  });

  it.each(['http://internal', 'not-a-url'])(
    'OFF→ON with an INVALID saved canonical_domain (%s) → 400',
    async (domain) => {
      delete process.env.CLIENT_DOMAIN;
      const { ctrl, prisma } = mockSetController({
        search_engine_indexing: 'false',
        canonical_domain: domain,
      });
      await expectGuardRejection(
        ctrl.set('search_engine_indexing', { value: 'true' }, superadmin),
      );
      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    },
  );

  it('OFF→ON when CLIENT_DOMAIN is set but NO domain is saved → 400 (derive-on-read does NOT satisfy the guard)', async () => {
    process.env.CLIENT_DOMAIN = 'demo.ecomate.bd';
    const { ctrl, prisma } = mockSetController({
      search_engine_indexing: 'false',
    });
    await expectGuardRejection(
      ctrl.set('search_engine_indexing', { value: 'true' }, superadmin),
    );
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
