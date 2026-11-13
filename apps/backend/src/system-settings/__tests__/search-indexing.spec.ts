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
